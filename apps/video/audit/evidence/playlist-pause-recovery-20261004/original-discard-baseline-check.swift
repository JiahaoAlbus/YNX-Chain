import Foundation
@main enum OriginalDiscardCheck {
 @MainActor static func main() throws {
  var bytes:Data?
  let store=try VideoViewerState(account:"ynx1"+String(repeating:"q",count:38),read:{bytes},write:{bytes=$0},require:{})
  let original=try store.reservePlaylist("Original response unknown")
  try store.discardPlaylist(original)
  let retained=String(data:bytes!,encoding:.utf8)!.contains(original.key)
  print("Original source 5630898b9 explicit discard retained original request key: \(retained); injected ordinary cache only")
  if !retained { exit(1) }
 }
}
