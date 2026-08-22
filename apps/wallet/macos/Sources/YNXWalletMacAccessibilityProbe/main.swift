import ApplicationServices
import Foundation

struct Query {
  let pid: pid_t
  let identifier: String
  let visibleText: String
}

private func argument(_ name: String, in arguments: [String]) -> String? {
  guard let index = arguments.firstIndex(of: name), arguments.indices.contains(index + 1) else {
    return nil
  }
  return arguments[index + 1]
}

private func parseQuery() -> Query? {
  let arguments = CommandLine.arguments
  guard
    let pidText = argument("--pid", in: arguments),
    let pidValue = Int32(pidText),
    pidValue > 0,
    let identifier = argument("--identifier", in: arguments),
    !identifier.isEmpty
  else {
    return nil
  }
  return Query(
    pid: pidValue,
    identifier: identifier,
    visibleText: argument("--contains", in: arguments) ?? ""
  )
}

private func copyAttribute(_ name: CFString, from element: AXUIElement) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name, &value) == .success else {
    return nil
  }
  return value
}

private func stringAttribute(_ name: CFString, from element: AXUIElement) -> String {
  copyAttribute(name, from: element) as? String ?? ""
}

private func boolAttribute(_ name: CFString, from element: AXUIElement) -> Bool? {
  if let number = copyAttribute(name, from: element) as? NSNumber {
    return number.boolValue
  }
  return nil
}

private func children(of element: AXUIElement) -> [AXUIElement] {
  let childAttributes: [CFString] = [
    kAXWindowsAttribute as CFString,
    kAXChildrenAttribute as CFString,
    kAXContentsAttribute as CFString,
    kAXRowsAttribute as CFString,
  ]
  return childAttributes.flatMap { attribute in
    copyAttribute(attribute, from: element) as? [AXUIElement] ?? []
  }
}

private func searchableText(of element: AXUIElement) -> String {
  [
    stringAttribute(kAXRoleAttribute as CFString, from: element),
    stringAttribute(kAXIdentifierAttribute as CFString, from: element),
    stringAttribute(kAXTitleAttribute as CFString, from: element),
    stringAttribute(kAXValueAttribute as CFString, from: element),
    stringAttribute(kAXDescriptionAttribute as CFString, from: element),
    stringAttribute(kAXHelpAttribute as CFString, from: element),
  ]
  .filter { !$0.isEmpty }
  .joined(separator: " ")
}

guard let query = parseQuery() else {
  FileHandle.standardError.write(
    Data("usage: YNXWalletMacAccessibilityProbe --pid PID --identifier IDENTIFIER [--contains TEXT]\n".utf8)
  )
  exit(64)
}

let application = AXUIElementCreateApplication(query.pid)
var roleValue: CFTypeRef?
let rootStatus = AXUIElementCopyAttributeValue(application, kAXRoleAttribute as CFString, &roleValue)
guard rootStatus == .success else {
  FileHandle.standardError.write(
    Data("accessibility root unavailable pid=\(query.pid) error=\(rootStatus.rawValue)\n".utf8)
  )
  exit(69)
}

var queue: [(AXUIElement, Int)] = [(application, 0)]
var scanned = 0
let maximumDepth = 32
let maximumNodes = 10_000

while !queue.isEmpty && scanned < maximumNodes {
  let (element, depth) = queue.removeFirst()
  scanned += 1
  let identifier = stringAttribute(kAXIdentifierAttribute as CFString, from: element)
  let text = searchableText(of: element)
  if identifier == query.identifier || (!query.visibleText.isEmpty && text.contains(query.visibleText)) {
    let enabled = boolAttribute(kAXEnabledAttribute as CFString, from: element) ?? false
    print("\(enabled)\t\(text)")
    exit(0)
  }
  if depth < maximumDepth {
    queue.append(contentsOf: children(of: element).map { ($0, depth + 1) })
  }
}

FileHandle.standardError.write(
  Data("accessibility element not found pid=\(query.pid) identifier=\(query.identifier) scanned=\(scanned)\n".utf8)
)
exit(70)
