fn main() {
    // Build input only: the app never reads a runtime environment/IPC authority
    // override. Resource preparation/portable staging use the same explicit lock.
    println!("cargo:rerun-if-env-changed=HIKARU_CRISPASR_CANDIDATE_LOCK");
    let lock = match std::env::var_os("HIKARU_CRISPASR_CANDIDATE_LOCK") {
        Some(path) => {
            let path = std::path::PathBuf::from(path);
            assert!(path.is_absolute(), "candidate lock must be absolute");
            path
        }
        None => std::path::PathBuf::from("../native-asr/runtime/crispasr-product-lock.json"),
    };
    println!("cargo:rerun-if-changed={}", lock.display());
    std::fs::copy(
        lock,
        std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap())
            .join("crispasr-runtime-lock.json"),
    )
    .expect("CrispASR build authority missing");
    tauri_build::build()
}
