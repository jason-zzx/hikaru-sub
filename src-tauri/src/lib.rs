mod asr;
mod asr_setup;
mod ass;
mod asset_scope;
mod burn;
mod download;
mod ffmpeg;
mod fonts;
mod hls_download;
mod hls_fetch;
mod hls_playlist;
mod hls_types;
mod media_server;
mod preview;
mod process;
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
        .manage(asr_setup::AsrSetupState::default())
        .invoke_handler(tauri::generate_handler![
            settings::get_settings,
            settings::set_settings,
            ffmpeg::check_ffmpeg,
            ffmpeg::extract_audio,
            ffmpeg::get_video_info,
            ffmpeg::extract_waveform,
            fonts::discover_preview_fonts,
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
            asr_setup::probe_asr_setup_environment,
            asr_setup::start_asr_setup,
            asr_setup::get_asr_setup_progress,
            asr_setup::cancel_asr_setup,
            ass::save_ass_text,
            ass::load_ass_text,
            asset_scope::allow_asset_path,
            media_server::register_media_playback,
            preview::render_subtitle_preview_frame,
            transcode::detect_video_codec,
            transcode::probe_video_playback,
            transcode::start_transcode,
            transcode::check_transcode_progress,
            transcode::stop_transcode,
            download::probe_download_media,
            download::start_video_download,
            download::get_video_download_progress,
            download::cancel_video_download,
            burn::probe_burn_video,
            burn::start_burn_subtitles,
            burn::get_burn_progress,
            burn::cancel_burn,
        ])
        .setup(|app| {
            transcode::init_transcode_state(app);
            download::init_download_state(app);
            burn::init_burn_state(app);
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
                if let Some(state) = app_handle.try_state::<burn::BurnState>() {
                    state.shutdown();
                }
                if let Some(state) = app_handle.try_state::<asr_setup::AsrSetupState>() {
                    state.shutdown();
                }
            }
        });
}
