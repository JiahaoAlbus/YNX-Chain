import Foundation
import CoreGraphics
import ImageIO
import CryptoKit
func pixels(_ path:String) throws -> String {
 guard let source=CGImageSourceCreateWithURL(URL(fileURLWithPath:path) as CFURL,nil),let image=CGImageSourceCreateImageAtIndex(source,0,nil) else { throw NSError(domain:"PNG",code:1) }
 var bytes=[UInt8](repeating:0,count:image.width*image.height*4)
 guard let space=CGColorSpace(name:CGColorSpace.sRGB),let context=CGContext(data:&bytes,width:image.width,height:image.height,bitsPerComponent:8,bytesPerRow:image.width*4,space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { throw NSError(domain:"PNG",code:2) }
 context.draw(image,in:CGRect(x:0,y:0,width:image.width,height:image.height))
 return "\(image.width)x\(image.height):"+SHA256.hash(data:Data(bytes)).map{String(format:"%02x",$0)}.joined()
}
let hashes=try CommandLine.arguments.dropFirst().map(pixels);guard Set(hashes).count==1 else { throw NSError(domain:"PNG pixels differ",code:3) };print(hashes[0])
