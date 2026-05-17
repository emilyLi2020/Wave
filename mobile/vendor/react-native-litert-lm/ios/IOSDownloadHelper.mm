#import <Foundation/Foundation.h>
#include "../cpp/IOSDownloadHelper.h"
#include <stdexcept>

namespace litert_lm {

std::string downloadModelFile(
    const std::string& url,
    const std::string& fileName,
    const std::optional<std::function<void(double)>>& onProgress) {
  @autoreleasepool {
    NSString* nsUrl = [NSString stringWithUTF8String:url.c_str()];
    NSString* nsFileName = [NSString stringWithUTF8String:fileName.c_str()];
    
    // Use Caches directory — survives app relaunch but can be
    // reclaimed by the system under storage pressure.
    NSString* cachesDir = NSSearchPathForDirectoriesInDomains(
        NSCachesDirectory, NSUserDomainMask, YES).firstObject;
    NSString* modelsDir = [cachesDir stringByAppendingPathComponent:@"litert_models"];
    
    // Create models subdirectory
    NSFileManager* fm = [NSFileManager defaultManager];
    if (![fm fileExistsAtPath:modelsDir]) {
      [fm createDirectoryAtPath:modelsDir
          withIntermediateDirectories:YES
                          attributes:nil
                               error:nil];
    }
    
    NSString* destPath = [modelsDir stringByAppendingPathComponent:nsFileName];
    
    // If the file already exists and has content, skip download
    if ([fm fileExistsAtPath:destPath]) {
      NSDictionary* attrs = [fm attributesOfItemAtPath:destPath error:nil];
      unsigned long long fileSize = [attrs fileSize];
      if (fileSize > 0) {
        NSLog(@"[LiteRTLM] Model already cached at %@ (%llu bytes), skipping download",
              destPath, fileSize);
        if (onProgress.has_value()) {
          onProgress.value()(1.0);
        }
        return std::string([destPath UTF8String]);
      }
    }
    
    NSLog(@"[LiteRTLM] Downloading model from %@ to %@", nsUrl, destPath);
    
    NSURL* requestUrl = [NSURL URLWithString:nsUrl];
    if (!requestUrl) {
      throw std::runtime_error("Invalid download URL: " + url);
    }
    
    // Synchronous download using NSURLSession on this background thread.
    __block NSError* downloadError = nil;
    
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    
    NSURLSessionConfiguration* config = [NSURLSessionConfiguration defaultSessionConfiguration];
    config.timeoutIntervalForRequest = 30;
    config.timeoutIntervalForResource = 3600; // 1 hour for large models
    
    NSURLSession* session = [NSURLSession sessionWithConfiguration:config];
    NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:requestUrl];
    [request setHTTPMethod:@"GET"];
    
    // Use downloadTask for proper progress tracking and disk-efficient downloads
    NSURLSessionDownloadTask* task = [session downloadTaskWithRequest:request
        completionHandler:^(NSURL* location, NSURLResponse* response, NSError* error) {
      if (error) {
        downloadError = error;
        dispatch_semaphore_signal(semaphore);
        return;
      }
      
      // Check HTTP status
      if ([response isKindOfClass:[NSHTTPURLResponse class]]) {
        NSInteger statusCode = [(NSHTTPURLResponse*)response statusCode];
        if (statusCode >= 400) {
          downloadError = [NSError errorWithDomain:@"LiteRTLM"
                                              code:statusCode
                                          userInfo:@{NSLocalizedDescriptionKey:
              [NSString stringWithFormat:@"HTTP %ld", (long)statusCode]}];
          dispatch_semaphore_signal(semaphore);
          return;
        }
      }
      
      // Move downloaded file to destination
      NSError* moveError = nil;
      [fm removeItemAtPath:destPath error:nil]; // Remove any partial file
      if (![fm moveItemAtURL:location
                       toURL:[NSURL fileURLWithPath:destPath]
                       error:&moveError]) {
        downloadError = moveError;
      }
      
      dispatch_semaphore_signal(semaphore);
    }];
    
    [task resume];
    
    // Poll for progress while waiting for completion
    while (dispatch_semaphore_wait(semaphore,
           dispatch_time(DISPATCH_TIME_NOW, 500 * NSEC_PER_MSEC)) != 0) {
      if (onProgress.has_value() && task.countOfBytesExpectedToReceive > 0) {
        double progress = (double)task.countOfBytesReceived /
                          (double)task.countOfBytesExpectedToReceive;
        onProgress.value()(progress);
      }
    }
    
    [session finishTasksAndInvalidate];
    
    if (downloadError) {
      throw std::runtime_error("Download failed: " + 
          std::string([[downloadError localizedDescription] UTF8String]));
    }
    
    // Final progress callback
    if (onProgress.has_value()) {
      onProgress.value()(1.0);
    }
    
    NSLog(@"[LiteRTLM] Model downloaded successfully to %@", destPath);
    return std::string([destPath UTF8String]);
  }
}

} // namespace litert_lm
