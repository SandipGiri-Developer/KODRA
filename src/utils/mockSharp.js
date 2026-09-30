/**
 * Mock for sharp library.
 * Transformers.js imports sharp for image processing.
 * Since Kodra only uses text feature-extraction embeddings (all-MiniLM-L6-v2),
 * sharp's native image manipulation binaries are not required.
 * This mock prevents native compilation/download errors across all platforms.
 */
function mockSharp() {
  return {
    rotate: () => mockSharp(),
    raw: () => mockSharp(),
    toBuffer: async () => ({ data: new Uint8Array(), info: { width: 0, height: 0, channels: 0 } }),
    metadata: async () => ({ channels: 0, width: 0, height: 0 }),
  };
}

module.exports = mockSharp;
module.exports.default = mockSharp;
