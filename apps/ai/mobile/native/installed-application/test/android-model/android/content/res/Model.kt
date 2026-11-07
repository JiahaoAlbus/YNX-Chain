package android.content.res
class AssetManager(val root: java.io.File) { fun open(name: String): java.io.InputStream = root.resolve(name).inputStream() }
