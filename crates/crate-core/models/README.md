# Modèle de tags audio

- `mn04_as.nnef.tgz` : EfficientAT `mn04_as` (MobileNetV3 × 0,4, 983 599 paramètres), entraîné sur AudioSet
  (527 classes, mAP 0,432), converti en NNEF. Entrée : mel `[1, 1, 128, T]` ; sorties : logits `[1, 527]`,
  vecteur `[1, 384]`.
- `mel_banks.bin` : la matrice mel du prétraitement d'EfficientAT (128 bandes, 513 bins, creuse).

Reproduire : `scripts/model/export_efficientat.py` (export ONNX, matrice, références de test), puis
`scripts/model/onnx2nnef`.

## Provenance et licences

- Code et poids : <https://github.com/fschmid56/EfficientAT> (Florian Schmid, Khaled Koutini, Gerhard Widmer,
  « Efficient Large-scale Audio Tagging via Transformer-to-CNN Knowledge Distillation », ICASSP 2023).

  > MIT License — Copyright (c) 2022 Florian Schmid
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
  > documentation files (the "Software"), to deal in the Software without restriction, including without limitation
  > the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
  > to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all copies or substantial portions of
  > the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
  > THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
  > CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
  > IN THE SOFTWARE.

- Classes : ontologie AudioSet (Google, CC BY-SA 4.0 ; libellés et index de `class_labels_indices.csv`), dont seuls
  quelques index sont utilisés (`src/ml.rs`, `CLASS_TAGS`).
