mod asr;
mod ass;
mod asset_scope;
mod download;
mod hls_download;
mod hls_fetch;
mod hls_playlist;
mod hls_types;
mod ffmpeg;
mod media_server;
mod project;
mod settings;
mod transcode;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_persisted_scope::init())
        .manage(asr::AsrState::default())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_settings,
            ffmpeg::check_ffmpeg,
            ffmpeg::extract_audio,
            ffmpeg::get_video_info,
            ffmpeg::extract_waveform,
            project::create_project,
            project::open_project,
            project::path_exists,
            asr::list_asr_engines,
            asr::start_asr,
            asr::get_asr_progress,
            asr::cancel_asr,
            asr::check_asr_model,
            asr::download_asr_model,
            asr::get_model_download_progress,
            ass::save_ass_text,
            ass::load_ass_text,
            asset_scope::allow_asset_path,
            media_server::register_media_playback,
            transcode::detect_video_codec,
            transcode::probe_video_playback,
            transcode::start_transcode,
            transcode::check_transcode_progress,
            transcode::stop_transcode,
            download::probe_download_media,
            download::start_video_download,
            download::get_video_download_progress,
            download::cancel_video_download,
        ])
        .setup(|app| {
            transcode::init_transcode_state(app);
            download::init_download_state(app);
            let server = tauri::async_runtime::block_on(media_server::MediaServer::start())
                .expect("failed to start media server");
            app.manage(server);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // 应用退出时尽力终止 sidecar 进程，避免残留
            if let tauri::RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<asr::AsrState>() {
                    if let Ok(mut guard) = state.sidecar.try_lock() {
                        if let Some(mut sidecar) = guard.take() {
                            sidecar.kill();
                        }
                    }
                }
            }
        });
}
