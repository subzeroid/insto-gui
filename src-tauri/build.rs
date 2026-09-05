fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "prepare_desktop",
            "inspect_setup",
            "configure_setup",
            "replace_credentials",
            "start_service",
            "stop_service",
            "repair_service",
            "open_token_page",
        ]),
    ))
    .expect("application configuration is invalid");
}
