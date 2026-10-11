//! `onnx2nnef <modèle.onnx> <modèle.nnef.tgz>` : même réseau, lu sans protobuf par `tract-nnef` (binaire plus léger).
use tract_onnx::prelude::*;
use tract_onnx::WithOnnx;

fn main() -> TractResult<()> {
    let args: Vec<String> = std::env::args().collect();
    let [_, onnx, nnef] = &args[..] else {
        eprintln!("usage : onnx2nnef <modèle.onnx> <modèle.nnef.tgz>");
        std::process::exit(2);
    };
    let model = tract_onnx::onnx().model_for_path(onnx)?.into_typed()?.into_decluttered()?;
    tract_nnef::nnef().with_onnx().write_to_tar(&model, std::fs::File::create(nnef)?)?;
    println!("{nnef} écrit");
    Ok(())
}
