"""Export du modèle de tags audio (EfficientAT mn04_as, licence MIT, AudioSet 527 classes) pour crate-core.

Usage unique, hors CI. Produit, dans crates/crate-core/models/ :
  - mn04_as.onnx      le réseau (entrée : mel [1, 1, 128, T], sorties : logits [1, 527], vecteur [1, 384]) ;
  - mel_banks.bin     la matrice mel exacte d'EfficientAT (bandes creuses : début u16, longueur u16, poids f32) ;
et dans crates/crate-core/tests/fixtures/ :
  - efficientat_ref.json  mels et logits de référence pour 3 sons synthétiques (tests de dsp.rs et ml.rs).

Le ONNX est ensuite converti en NNEF (plus léger à charger) par scripts/model/onnx2nnef.

    python3 -m venv /tmp/venv && /tmp/venv/bin/pip install torch torchaudio torchvision onnx numpy
    git clone https://github.com/fschmid56/EfficientAT /tmp/EfficientAT
    /tmp/venv/bin/python scripts/model/export_efficientat.py /tmp/EfficientAT
    (cd scripts/model/onnx2nnef && cargo run --release -- ../../../crates/crate-core/models/mn04_as.onnx \\
        ../../../crates/crate-core/models/mn04_as.nnef.tgz)
"""

import json
import math
import os
import struct
import sys
import tempfile
import types

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS = os.path.join(ROOT, "crates", "crate-core", "models")
FIXTURES = os.path.join(ROOT, "crates", "crate-core", "tests", "fixtures")


def main(repo: str) -> None:
    # models/mn/model.py importe helpers.utils, qui lit un CSV relatif au dossier courant : on fournit le seul
    # symbole utilisé (NAME_TO_WIDTH) sans exécuter ce module.
    helpers = types.ModuleType("helpers")
    utils = types.ModuleType("helpers.utils")
    utils.NAME_TO_WIDTH = lambda name: {"mn04": 0.4}.get(name[:4], 1.0)
    helpers.utils = utils
    sys.modules["helpers"], sys.modules["helpers.utils"] = helpers, utils
    sys.path.insert(0, repo)

    import numpy as np
    import torch
    import torchaudio
    from models.mn.model import get_model
    from models.preprocess import AugmentMelSTFT

    os.makedirs(MODELS, exist_ok=True)
    work = tempfile.mkdtemp()
    cwd = os.getcwd()
    os.chdir(work)  # les poids sont téléchargés dans ./resources
    try:
        model = get_model(width_mult=0.4, pretrained_name="mn04_as", head_type="mlp").eval()
    finally:
        os.chdir(cwd)
    mel = AugmentMelSTFT(n_mels=128, sr=32000, win_length=800, hopsize=320).eval()

    class Wrap(torch.nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m

        def forward(self, x):
            logits, feats = self.m(x)
            return logits.reshape(1, 527), feats.reshape(1, -1)

    wrap = Wrap(model).eval()
    torch.onnx.export(
        wrap,
        (torch.randn(1, 1, 128, 400),),
        os.path.join(MODELS, "mn04_as.onnx"),
        input_names=["mel"],
        output_names=["logits", "feats"],
        opset_version=13,
        dynamo=False,
        dynamic_axes={"mel": {3: "T"}},
    )

    # Matrice mel d'évaluation (sans augmentation), avec la colonne de zéros qui la porte à 513 bins.
    banks, _ = torchaudio.compliance.kaldi.get_mel_banks(128, 1024, 32000, mel.fmin, mel.fmax, vtln_low=100.0, vtln_high=-500.0, vtln_warp_factor=1.0)
    banks = torch.nn.functional.pad(banks, (0, 1), mode="constant", value=0).numpy().astype(np.float32)
    with open(os.path.join(MODELS, "mel_banks.bin"), "wb") as f:
        f.write(struct.pack("<HH", banks.shape[0], banks.shape[1]))
        for row in banks:
            nz = np.nonzero(row)[0]
            start, end = (int(nz[0]), int(nz[-1]) + 1) if len(nz) else (0, 0)
            f.write(struct.pack("<HH", start, end - start))
            f.write(row[start:end].astype("<f4").tobytes())

    # Sons de référence, recalculés à l'identique côté Rust (tests) : formules sans hasard, à 32 kHz.
    sr = 32000

    def sine():
        return [0.5 * math.sin(2 * math.pi * 440 * i / sr) for i in range(sr)]

    def kick():
        out = []
        for i in range(sr // 2):
            t = i / sr
            phase = 2 * math.pi * (50 * t + 100 / 30 * (1 - math.exp(-30 * t)))
            out.append(math.sin(phase) * math.exp(-8 * t))
        return out

    def chord():
        out = []
        for i in range(2 * sr):
            t = i / sr
            s = sum(math.sin(2 * math.pi * f * t) / (h + 1) for h, f in enumerate([220.0, 277.18, 329.63, 440.0]))
            out.append(0.25 * s * (0.6 + 0.4 * math.sin(2 * math.pi * 3 * t)))
        return out

    refs = []
    for name, wav in [("sine", sine()), ("kick", kick()), ("chord", chord())]:
        x = torch.tensor([wav], dtype=torch.float32)
        with torch.no_grad():
            spec = mel(x)  # [1, 128, T]
            logits, _ = wrap(spec.unsqueeze(0))
        spec = spec[0].numpy()
        refs.append(
            {
                "name": name,
                "frames": int(spec.shape[1]),
                "bandMeans": [round(float(v), 6) for v in spec.mean(axis=1)],
                "frame0": [round(float(v), 6) for v in spec[:, 0]],
                "frameMid": [round(float(v), 6) for v in spec[:, spec.shape[1] // 2]],
                "logits": [round(float(v), 5) for v in logits[0].numpy()],
            }
        )
    with open(os.path.join(FIXTURES, "efficientat_ref.json"), "w") as f:
        json.dump(refs, f, indent=0)
    print(f"modèle, matrice mel et références écrits ({len(refs)} sons)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
