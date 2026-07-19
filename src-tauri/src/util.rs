use std::time::{SystemTime, UNIX_EPOCH};

use crate::db::{self, DbPool};

pub fn take_bytes_at_char_boundary(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = 0;
    for (i, ch) in s.char_indices() {
        let next = i + ch.len_utf8();
        if next > max_bytes {
            break;
        }
        end = next;
    }
    &s[..end]
}

pub(crate) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as i64
}

pub(crate) fn get_conn(pool: &DbPool) -> Result<db::PooledConn, String> {
    pool.get().map_err(|e| format!("db connection error: {e}"))
}

pub(crate) fn double_option<'de, T, D>(de: D) -> Result<Option<Option<T>>, D::Error>
where
    T: serde::Deserialize<'de>,
    D: serde::Deserializer<'de>,
{
    serde::Deserialize::deserialize(de).map(Some)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_take_bytes_ascii() {
        assert_eq!(take_bytes_at_char_boundary("hello world", 5), "hello");
    }

    #[test]
    fn test_take_bytes_short_string() {
        assert_eq!(take_bytes_at_char_boundary("hi", 10), "hi");
    }

    #[test]
    fn test_take_bytes_multibyte() {
        let s = "hello世界";
        assert_eq!(take_bytes_at_char_boundary(s, 5), "hello");
        assert_eq!(take_bytes_at_char_boundary(s, 6), "hello");
        assert_eq!(take_bytes_at_char_boundary(s, 7), "hello");
        assert_eq!(take_bytes_at_char_boundary(s, 8), "hello世");
        assert_eq!(take_bytes_at_char_boundary(s, 11), "hello世界");
    }

    #[test]
    fn test_take_bytes_zero() {
        assert_eq!(take_bytes_at_char_boundary("hello", 0), "");
    }
}
