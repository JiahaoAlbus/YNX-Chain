// Node-only PRIVATE Main consumer facade. Same original protected native
// loader, no injectable provider/path/ENV, Root DTO or serializable FD owner.
export {
 acquireOriginalPQHostCatalogSource,
 isOriginalPQHostCatalogSource,
 readOriginalPQHostCatalogHandoff,
 assertOriginalPQHostCatalogSourceCurrent,
 observeOriginalPQHostCatalogSourceRevocation,
 retireOriginalPQHostCatalogSource,
 joinOriginalPQHostCatalogSource,
 closeOriginalPQHostCatalogSource,
 readOriginalPQHostCatalogSourceStatus,
} from './original-auth-identity-private-joint-registration.js';
