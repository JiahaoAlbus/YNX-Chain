import AppKit
import Foundation

guard CommandLine.arguments.count == 2 else {
    FileHandle.standardError.write(Data("usage: resolve-macos-handler.swift <url>\n".utf8))
    exit(64)
}

guard let target = URL(string: CommandLine.arguments[1]) else {
    FileHandle.standardError.write(Data("invalid URL\n".utf8))
    exit(65)
}

guard let application = NSWorkspace.shared.urlForApplication(toOpen: target) else {
    FileHandle.standardError.write(Data("no registered handler\n".utf8))
    exit(66)
}

print(application.standardizedFileURL.path)
