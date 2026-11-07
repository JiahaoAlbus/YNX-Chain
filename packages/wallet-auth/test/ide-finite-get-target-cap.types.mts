import {inspectOriginalIDEFiniteGETTargetV1DATA as inspect,type IDEFiniteGETTargetV1DATA as Cap} from '../native/original-ide-finite-get-target-v1-data.mjs';
const d=inspect({});const cap:Cap=d.cap;
// @ts-expect-error readonly signed projection
cap.port=1;
// @ts-expect-error no self digest in signed cap
cap.capSHA256;
// @ts-expect-error no fake Target qualification
const target:{qualified:true}=d;
// @ts-expect-error finite selector subset
const wrong:Cap={...cap,permittedSelectors:['POST']};
