// Fetching the current key with the browser's cookies: the portal's proxy-usage endpoint, as the
// logged-in user. What is done with the answer (the person's key) is the Store's.
import Foundation
import QuotaCore

enum CookieSync {
  /// Reads `browser`'s cookies for `url`'s site and asks the portal (off the main thread: the
  /// keychain and the cookie database take a moment).
  static func fetch(url: URL, browser: ChromeCookies.Browser) async -> Result<ProxyUsage, Failure> {
    await Task.detached { () async -> Result<ProxyUsage, Failure> in
      do {
        let cookie = try ChromeCookies.header(domain: url.host ?? "ai-coding.bilibili.co", browser: browser)
        let (data, resp) = try await URLSession(configuration: .ephemeral).data(for: ProxyUsageAPI.request(url: url, cookie: cookie))
        return ProxyUsageAPI.parse(status: (resp as? HTTPURLResponse)?.statusCode ?? 0, body: data)
      } catch let e as ChromeCookies.CookieError {
        return .failure(Failure(.network, e.errorDescription ?? "读取 cookie 失败"))
      } catch {
        return .failure(Failure(.network, error.localizedDescription))
      }
    }.value
  }
}
