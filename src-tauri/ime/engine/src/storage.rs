//! Writing a file so that a crash leaves either the old one or the new one.

use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::Path;

/// Writes `path` through a sibling temporary file: write, flush, `sync_all`,
/// rename. On any error the temporary file is removed and the old file, if
/// there was one, is untouched.
pub fn write_atomic<F>(path: &Path, write: F) -> io::Result<()>
where
    F: FnOnce(&mut dyn Write) -> io::Result<()>,
{
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    let tmp = path.with_file_name(format!(".{name}.tmp-{}", std::process::id()));
    let result = (|| {
        let file = File::create(&tmp)?;
        let mut w = BufWriter::new(file);
        write(&mut w)?;
        w.flush()?;
        w.get_ref().sync_all()?;
        std::fs::rename(&tmp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_leaves_no_tmp_and_keeps_old_on_failure() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.tsv");
        write_atomic(&path, |w| w.write_all(b"old")).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "old");
        let err = write_atomic(&path, |w| {
            w.write_all(b"half")?;
            Err(io::Error::other("boom"))
        });
        assert!(err.is_err());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "old",
            "the old file survives a failed write"
        );
        assert_eq!(
            std::fs::read_dir(dir.path()).unwrap().count(),
            1,
            "no temp file is left behind"
        );
        write_atomic(&path, |w| w.write_all(b"new")).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
    }
}
