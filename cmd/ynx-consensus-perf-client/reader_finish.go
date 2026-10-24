package main

// finishDurableReader is called only after all observation workers have joined.
// Its owned statistics survive the reader, including early-error defer paths.
func finishDurableReader(reader **durableReader, stats *durableReaderStats) {
	if *reader != nil {
		*stats = (*reader).stats()
		*reader = nil
	}
}
