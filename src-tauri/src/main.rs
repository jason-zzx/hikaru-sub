// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Linux WebKit/GStreamer 需要显式允许 asset 协议（图片等仍可能用到）
    std::env::set_var("WEBKIT_GST_ALLOWED_URI_PROTOCOLS", "asset");
    hikaru_sub_lib::run()
}
