/**
 * Zero-dependency UUID v4 Generator Utility
 * Generates RFC-4122 compliant UUID v4 strings using pure JavaScript string manipulation.
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c: string): string => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

generateUuid.v4 = generateUuid;

export default generateUuid;
export { generateUuid };
