//! Verification and transactional publication of the bundled Python runtime.

mod filesystem;
mod inventory;
pub mod manifest;
mod publish;
pub use publish::{account_home, application_root, publish, PublishedRuntime};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RuntimeError {
    Manifest,
    Incompatible,
    Ownership,
    Integrity,
    Storage,
    Timeout,
    Handshake,
}

impl std::fmt::Display for RuntimeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Manifest => "The bundled runtime manifest is invalid.",
            Self::Incompatible => "The bundled runtime is incompatible with this application.",
            Self::Ownership => "The runtime location cannot be used safely.",
            Self::Integrity => "The runtime content could not be verified.",
            Self::Storage => "The private runtime could not be prepared.",
            Self::Timeout => "Runtime preparation timed out.",
            Self::Handshake => "The bundled core could not be started.",
        })
    }
}

impl std::error::Error for RuntimeError {}

type Result<T> = std::result::Result<T, RuntimeError>;
