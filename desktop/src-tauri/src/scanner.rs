use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ScanResult {
    pub file_count: usize,
    pub dir_count: usize,
    pub total_bytes: u64,
    pub duration_ms: u128,
    pub throughput_files_sec: f64,
    pub errors: Vec<String>,
}

/// Native Windows-compatible directory traversal.
/// - Never follows symlinks or junctions into infinite loops.
/// - Never opens or reads file streams, preventing cloud placeholder hydration.
/// - Collects metadata (size, mtime) directly from filesystem entries.
pub fn scan_directory_native(root_str: &str) -> ScanResult {
    let start = Instant::now();
    let root = Path::new(root_str);
    let mut file_count = 0usize;
    let mut dir_count = 0usize;
    let mut total_bytes = 0u64;
    let mut errors = Vec::new();
    let mut stack: Vec<PathBuf> = vec![root.to_path_buf()];

    while let Some(current_dir) = stack.pop() {
        match fs::read_dir(&current_dir) {
            Ok(entries) => {
                for entry_res in entries {
                    match entry_res {
                        Ok(entry) => {
                            let path = entry.path();
                            // In Windows/Rust, symlink_metadata retrieves reparse point info without following links
                            match entry.path().symlink_metadata() {
                                Ok(meta) => {
                                    let file_type = meta.file_type();
                                    if file_type.is_symlink() {
                                        // Do not recurse into symlinks or junctions
                                        continue;
                                    }
                                    if file_type.is_dir() {
                                        dir_count += 1;
                                        stack.push(path);
                                    } else if file_type.is_file() {
                                        file_count += 1;
                                        total_bytes += meta.len();
                                    }
                                }
                                Err(e) => {
                                    if errors.len() < 50 {
                                        errors.push(format!("{}: {}", path.display(), e));
                                    }
                                }
                            }
                        }
                        Err(e) => {
                            if errors.len() < 50 {
                                errors.push(format!("{}: {}", current_dir.display(), e));
                            }
                        }
                    }
                }
            }
            Err(e) => {
                if errors.len() < 50 {
                    errors.push(format!("{}: {}", current_dir.display(), e));
                }
            }
        }
    }

    let elapsed = start.elapsed();
    let ms = elapsed.as_millis();
    let throughput = if ms > 0 {
        (file_count as f64) / (ms as f64 / 1000.0)
    } else {
        0.0
    };

    ScanResult {
        file_count,
        dir_count,
        total_bytes,
        duration_ms: ms,
        throughput_files_sec: throughput,
        errors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scan_counts_an_isolated_fixture_and_reports_missing_roots() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let root = std::env::temp_dir().join(format!("groundwork-native-scan-{}-{}", std::process::id(), unique));
        fs::create_dir_all(root.join("nested")).unwrap();
        fs::write(root.join("first.bin"), b"123").unwrap();
        fs::write(root.join("nested/second.bin"), b"12345678").unwrap();
        let result = scan_directory_native(root.to_str().unwrap());
        assert_eq!((result.file_count, result.dir_count, result.total_bytes), (2, 1, 11));
        assert!(result.errors.is_empty());
        fs::remove_dir_all(&root).unwrap();
        assert!(!scan_directory_native(root.to_str().unwrap()).errors.is_empty());
    }
}
