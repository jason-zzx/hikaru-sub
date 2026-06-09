mod ffmpeg;
mod project;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_settings,
            ffmpeg::check_ffmpeg,
            ffmpeg::extract_audio,
            project::create_project,
            project::open_project,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
