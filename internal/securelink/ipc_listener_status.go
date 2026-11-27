package securelink

import "errors"

// ErrOriginalPrivateListenerCloseUnknown means the first physical close did not
// return successfully. The original listener is retained and is not reclosed.
var ErrOriginalPrivateListenerCloseUnknown = errors.New("LINK original private listener close unknown")

// OriginalPrivateListenerStatus reports only the original listener's close.
// It grants no authority and says nothing about accepted connections or owners.
type OriginalPrivateListenerStatus struct {
	CloseStarted, CloseReturned, CloseConfirmed bool
	FirstError                                  error
}
