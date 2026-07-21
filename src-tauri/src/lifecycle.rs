use tauri::AppHandle;

/// Confirmed frontend close requests use the app lifecycle so window APIs cannot
/// re-enter or leave the main window alive after an async dialog.
#[tauri::command]
pub fn exit_app(app: AppHandle) {
    app.exit(0);
}
