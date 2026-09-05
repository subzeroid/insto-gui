use super::{Result, RuntimeError};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub const MAX_MANIFEST_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_ENTRIES: usize = 50_000;
pub const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_TOTAL_BYTES: u64 = 1024 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Entry {
    Directory {
        path: String,
        mode: u32,
    },
    File {
        path: String,
        mode: u32,
        size: u64,
        sha256: String,
    },
}

impl Entry {
    pub fn path(&self) -> &str {
        match self {
            Self::Directory { path, .. } | Self::File { path, .. } => path,
        }
    }
    pub fn mode(&self) -> u32 {
        match self {
            Self::Directory { mode, .. } | Self::File { mode, .. } => *mode,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inputs {
    pub core_commit: String,
    pub core_wheel_name: String,
    pub core_wheel_sha256: String,
    pub requirements_sha256: String,
    pub build_constraints_sha256: String,
    pub uv_version: String,
    pub architecture: String,
    pub python_version: String,
    pub upstream_url: String,
    pub upstream_sha256: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub manifest_version: u64,
    pub build_id: String,
    pub inputs: Inputs,
    pub files: Vec<Entry>,
}

impl Manifest {
    pub fn parse(raw: &[u8], architecture: &str) -> Result<Self> {
        if raw.len() > MAX_MANIFEST_BYTES {
            return Err(RuntimeError::Manifest);
        }
        let mut value = crate::protocol::strict_json(raw).map_err(|_| RuntimeError::Manifest)?;
        ascii(&value)?;
        let manifest: Self =
            serde_json::from_value(value.clone()).map_err(|_| RuntimeError::Manifest)?;
        value
            .as_object_mut()
            .ok_or(RuntimeError::Manifest)?
            .remove("build_id");
        // serde_json's default maps are key-sorted. ASCII-only v1 strings make
        // these exact bytes match Python's ensure_ascii=True canonical JSON.
        let canonical = serde_json::to_vec(&value).map_err(|_| RuntimeError::Manifest)?;
        if manifest.manifest_version != 1
            || !hex(&manifest.build_id, 64)
            || format!("{:x}", Sha256::digest(canonical)) != manifest.build_id
        {
            return Err(RuntimeError::Manifest);
        }
        let pin: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packaging/core-pin.json"
        )))
        .map_err(|_| RuntimeError::Manifest)?;
        let python: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packaging/python-distributions.json"
        )))
        .map_err(|_| RuntimeError::Manifest)?;
        let inputs = &manifest.inputs;
        if inputs.architecture != architecture
            || !matches!(architecture, "arm64" | "x86_64")
            || Some(inputs.core_commit.as_str()) != pin["core_commit"].as_str()
            || inputs.core_wheel_name
                != format!(
                    "insto-{}-py3-none-any.whl",
                    pin["core_version"].as_str().ok_or(RuntimeError::Manifest)?
                )
            || Some(inputs.python_version.as_str()) != python["python_version"].as_str()
            || Some(inputs.upstream_url.as_str()) != python["targets"][architecture]["url"].as_str()
            || Some(inputs.upstream_sha256.as_str())
                != python["targets"][architecture]["sha256"].as_str()
        {
            return Err(RuntimeError::Incompatible);
        }
        if !hex(&inputs.core_commit, 40)
            || [
                &inputs.core_wheel_sha256,
                &inputs.requirements_sha256,
                &inputs.build_constraints_sha256,
                &inputs.upstream_sha256,
            ]
            .iter()
            .any(|hash| !hex(hash, 64))
        {
            return Err(RuntimeError::Manifest);
        }
        manifest.validate_entries()?;
        Ok(manifest)
    }

    fn validate_entries(&self) -> Result<()> {
        if self.files.is_empty() || self.files.len() > MAX_ENTRIES {
            return Err(RuntimeError::Manifest);
        }
        let mut directories = BTreeMap::new();
        let mut previous = "";
        let mut total = 0;
        let mut interpreter = false;
        for entry in &self.files {
            let name = entry.path();
            let mode = entry.mode();
            if name <= previous || name.contains('\\') || mode > 0o777 || mode & 0o022 != 0 {
                return Err(RuntimeError::Manifest);
            }
            if name != "." {
                if name
                    .split('/')
                    .any(|part| part.is_empty() || matches!(part, "." | ".."))
                {
                    return Err(RuntimeError::Manifest);
                }
                let parent = name.rsplit_once('/').map_or(".", |(parent, _)| parent);
                if !directories.contains_key(parent) {
                    return Err(RuntimeError::Manifest);
                }
            }
            match entry {
                Entry::Directory { .. } => {
                    directories.insert(name, ());
                }
                Entry::File { size, sha256, .. } => {
                    if name == "." || *size > MAX_FILE_BYTES || !hex(sha256, 64) {
                        return Err(RuntimeError::Manifest);
                    }
                    total += size;
                    if total > MAX_TOTAL_BYTES {
                        return Err(RuntimeError::Manifest);
                    }
                    if name == "bin/python3" {
                        if mode & 0o100 == 0 {
                            return Err(RuntimeError::Manifest);
                        }
                        interpreter = true;
                    }
                }
            }
            previous = name;
        }
        if !interpreter || !directories.contains_key(".") {
            return Err(RuntimeError::Manifest);
        }
        Ok(())
    }
}

fn hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn ascii(value: &Value) -> Result<()> {
    match value {
        Value::String(text) if !text.bytes().all(|b| (32..=126).contains(&b)) => {
            return Err(RuntimeError::Manifest)
        }
        Value::Object(map) => {
            for (key, value) in map {
                if !key.bytes().all(|b| (32..=126).contains(&b)) {
                    return Err(RuntimeError::Manifest);
                }
                ascii(value)?;
            }
        }
        Value::Array(array) => {
            for value in array {
                ascii(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests;
