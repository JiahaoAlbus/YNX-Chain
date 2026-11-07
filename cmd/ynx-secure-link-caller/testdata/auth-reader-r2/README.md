These files are unchanged frozen Auth source inputs for the original LINK
integration CI. `PROVENANCE.json` records the supplier handoff, header and CAS
hashes. `BASE-HANDOFF.json` is the prior handoff bound by the new supplier and
retains its ABI header pins. Update them only from a new original Auth handoff;
do not edit the Reader here.

The test links this production Reader body with actual LINK code and the pinned
original P09 Go server. Its explicit PUBLIC transport seam exercises ACK packet
ownership and prewrite cleanup. It does not construct a genuine Auth resource
reference, install the normal Native image, or grant Root/Source authority.
