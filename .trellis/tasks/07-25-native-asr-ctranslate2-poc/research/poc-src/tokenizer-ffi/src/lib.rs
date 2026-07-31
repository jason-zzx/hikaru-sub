use std::cell::RefCell;
use std::ffi::{CStr, CString, c_char};
use std::ptr;
use tokenizers::Tokenizer;

pub struct Handle(Tokenizer);

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

#[unsafe(no_mangle)]
pub unsafe extern "C" fn poc_tokenizer_open(path: *const c_char) -> *mut Handle {
    let result = unsafe { required_str(path, "tokenizer path") }
        .and_then(|path| Tokenizer::from_file(path).map_err(|error| error.to_string()));
    match result {
        Ok(tokenizer) => Box::into_raw(Box::new(Handle(tokenizer))),
        Err(error) => {
            set_error(error);
            ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn poc_tokenizer_close(handle: *mut Handle) {
    if !handle.is_null() {
        drop(unsafe { Box::from_raw(handle) });
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn poc_tokenizer_token_to_id(
    handle: *mut Handle,
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

#[unsafe(no_mangle)]
pub unsafe extern "C" fn poc_tokenizer_encode(
    handle: *mut Handle,
    text: *const c_char,
    ids: *mut *mut u32,
    len: *mut usize,
) -> i32 {
    if handle.is_null() || ids.is_null() || len.is_null() {
        set_error("encode received a null pointer");
        return 0;
    }
    let text = match unsafe { required_str(text, "text") } {
        Ok(value) => value,
        Err(error) => {
            set_error(error);
            return 0;
        }
    };
    let encoding = match unsafe { &*handle }.0.encode(text, false) {
        Ok(value) => value,
        Err(error) => {
            set_error(error);
            return 0;
        }
    };
    let mut output = encoding.get_ids().to_vec().into_boxed_slice();
    unsafe {
        *len = output.len();
        *ids = output.as_mut_ptr();
    }
    std::mem::forget(output);
    1
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn poc_tokenizer_ids_free(ids: *mut u32, len: usize) {
    if !ids.is_null() {
        drop(unsafe { Box::from_raw(std::slice::from_raw_parts_mut(ids, len)) });
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn poc_tokenizer_decode(
    handle: *mut Handle,
    ids: *const u32,
    len: usize,
    skip_special: i32,
) -> *mut c_char {
    if handle.is_null() || (ids.is_null() && len != 0) {
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

#[unsafe(no_mangle)]
pub unsafe extern "C" fn poc_tokenizer_string_free(value: *mut c_char) {
    if !value.is_null() {
        drop(unsafe { CString::from_raw(value) });
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn poc_tokenizer_last_error(buffer: *mut c_char, capacity: usize) -> usize {
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
