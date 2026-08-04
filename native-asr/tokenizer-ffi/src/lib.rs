use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char};
use std::ptr;
use tokenizers::Tokenizer;

pub struct HikaruTokenizerHandle(Tokenizer);

thread_local! {
    static LAST_ERROR: RefCell<CString> = RefCell::new(CString::new("no error").unwrap());
}

fn set_error(message: impl ToString) {
    let sanitized = message.to_string().replace('\0', "?");
    LAST_ERROR.with(|slot| *slot.borrow_mut() = CString::new(sanitized).unwrap());
}

unsafe fn required_str<'a>(value: *const c_char, name: &str) -> Result<&'a str, String> {
    if value.is_null() {
        return Err(format!("{name} is null"));
    }
    unsafe { CStr::from_ptr(value) }
        .to_str()
        .map_err(|_| format!("{name} is not UTF-8"))
}

/// # Safety
/// `path` must point to a valid NUL-terminated string for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn hikaru_tokenizer_open(path: *const c_char) -> *mut HikaruTokenizerHandle {
    let result = unsafe { required_str(path, "tokenizer path") }
        .and_then(|path| Tokenizer::from_file(path).map_err(|error| error.to_string()));
    match result {
        Ok(tokenizer) => Box::into_raw(Box::new(HikaruTokenizerHandle(tokenizer))),
        Err(error) => {
            set_error(error);
            ptr::null_mut()
        }
    }
}

/// # Safety
/// `handle` must be null or a live pointer returned by `hikaru_tokenizer_open`, and must not be
/// used again after this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn hikaru_tokenizer_close(handle: *mut HikaruTokenizerHandle) {
    if !handle.is_null() {
        drop(unsafe { Box::from_raw(handle) });
    }
}

/// # Safety
/// `handle` must be live, `token` must be a valid NUL-terminated string, and `output` must be
/// writable for one `u32`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn hikaru_tokenizer_token_to_id(
    handle: *mut HikaruTokenizerHandle,
    token: *const c_char,
    output: *mut u32,
) -> i32 {
    if handle.is_null() || output.is_null() {
        set_error("token_to_id received a null pointer");
        return 0;
    }
    let token = match unsafe { required_str(token, "token") } {
        Ok(value) => value,
        Err(error) => {
            set_error(error);
            return 0;
        }
    };
    match unsafe { &*handle }.0.token_to_id(token) {
        Some(id) => {
            unsafe { *output = id };
            1
        }
        None => {
            set_error(format!("token not found: {token}"));
            0
        }
    }
}

/// # Safety
/// `handle` must be live and `ids` must point to `len` initialized `u32` values. The returned
/// string must be released exactly once with `hikaru_tokenizer_string_free`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn hikaru_tokenizer_decode(
    handle: *mut HikaruTokenizerHandle,
    ids: *const u32,
    len: usize,
    skip_special: i32,
) -> *mut c_char {
    if handle.is_null() || ids.is_null() {
        set_error("decode received a null pointer");
        return ptr::null_mut();
    }
    let ids = unsafe { std::slice::from_raw_parts(ids, len) };
    match unsafe { &*handle }.0.decode(ids, skip_special != 0) {
        Ok(value) => match CString::new(value) {
            Ok(value) => value.into_raw(),
            Err(_) => {
                set_error("decoded text contains a NUL byte");
                ptr::null_mut()
            }
        },
        Err(error) => {
            set_error(error);
            ptr::null_mut()
        }
    }
}

/// # Safety
/// `value` must be null or a live pointer returned by `hikaru_tokenizer_decode`, and must not be
/// freed more than once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn hikaru_tokenizer_string_free(value: *mut c_char) {
    if !value.is_null() {
        drop(unsafe { CString::from_raw(value) });
    }
}

/// # Safety
/// When non-null, `buffer` must be writable for `capacity` bytes.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn hikaru_tokenizer_last_error(
    buffer: *mut c_char,
    capacity: usize,
) -> usize {
    LAST_ERROR.with(|slot| {
        let value = slot.borrow();
        let bytes = value.as_bytes_with_nul();
        if !buffer.is_null() && capacity != 0 {
            let count = bytes.len().min(capacity);
            unsafe { ptr::copy_nonoverlapping(bytes.as_ptr().cast(), buffer, count) };
            if count == capacity {
                unsafe { *buffer.add(capacity - 1) = 0 };
            }
        }
        bytes.len()
    })
}
