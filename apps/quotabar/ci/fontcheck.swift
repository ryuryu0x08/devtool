// Prints the fonts Core Text finds in each file given (CI: can it read .woff2 directly?).
import CoreText
import Foundation

for path in CommandLine.arguments.dropFirst() {
  let ds = CTFontManagerCreateFontDescriptorsFromURL(URL(fileURLWithPath: path) as CFURL) as? [CTFontDescriptor] ?? []
  let names = ds.map { CTFontDescriptorCopyAttribute($0, kCTFontFamilyNameAttribute) as? String ?? "?" }
  print("\((path as NSString).lastPathComponent): \(ds.count) font(s) \(names)")
}
