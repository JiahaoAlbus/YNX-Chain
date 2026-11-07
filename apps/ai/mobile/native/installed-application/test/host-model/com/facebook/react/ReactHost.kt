package com.facebook.react
// PUBLIC control boundary; production source is separately checked against the
// actual pinned RN 0.86 release interface, never this tiny model as App proof.
interface ReactHost { fun addBeforeDestroyListener(listener: () -> Unit) }
