#pragma once

#include <string>
#include <functional>
#include <optional>

namespace litert_lm {

/**
 * Download a file from a URL to the app's Caches/litert_models directory.
 * Uses NSURLSession for efficient, resumable downloads.
 * 
 * @param url HTTPS URL to download from
 * @param fileName Destination filename
 * @param onProgress Optional progress callback (0.0 to 1.0)
 * @return Absolute path to the downloaded file
 * @throws std::runtime_error on download failure
 */
std::string downloadModelFile(
    const std::string& url,
    const std::string& fileName,
    const std::optional<std::function<void(double)>>& onProgress);

} // namespace litert_lm
