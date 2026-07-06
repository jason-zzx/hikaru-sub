use std::ffi::OsStr;
use std::process::Command;

#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

#[cfg(not(windows))]
pub const CREATE_NO_WINDOW: u32 = 0;

pub fn hidden_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    hide_window(&mut command);
    command
}

pub fn hide_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_create_no_window_flag_matches_winapi_value() {
        assert_eq!(CREATE_NO_WINDOW, 0x08000000);
    }

    #[cfg(not(windows))]
    #[test]
    fn non_windows_create_no_window_flag_is_noop() {
        assert_eq!(CREATE_NO_WINDOW, 0);
    }
}
