// The single upload size limit, shared with the backend so client-side
// validation, UI copy and server enforcement can never disagree (same
// re-export pattern as lib/eventDate.ts).
export * from '../../../backend/src/lib/uploadLimits';
