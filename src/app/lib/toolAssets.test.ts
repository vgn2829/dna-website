import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from './uploadLimits';
import { IMAGE_MIME } from './assetLibrary';
import {
  TOOL_ASSET_MIME, TOOL_ASSET_VISIBILITY, checkToolOutput, pickTargetWorkspace, toolAssetFilename,
} from './toolAssets';

describe('tool output → asset: privacy and validation rules', () => {
  it('always saves privately', () => {
    expect(TOOL_ASSET_VISIBILITY).toBe('personal');
  });

  it('only allows formats the Asset Library already accepts as images', () => {
    for (const mime of Object.keys(TOOL_ASSET_MIME)) expect(IMAGE_MIME).toContain(mime);
  });

  it('refuses empty, unsupported and oversized results before any network call', () => {
    expect(checkToolOutput({ size: 0, type: 'image/png' })).toBe('empty');
    expect(checkToolOutput({ size: 10, type: 'text/html' })).toBe('type');
    expect(checkToolOutput({ size: 10, type: '' })).toBe('type');
    expect(checkToolOutput({ size: 10, type: 'application/pdf' })).toBe('type');
    expect(checkToolOutput({ size: MAX_UPLOAD_BYTES + 1, type: 'image/png' })).toBe('too-large');
    expect(checkToolOutput({ size: MAX_UPLOAD_BYTES, type: 'image/png' })).toBeNull();
    for (const type of Object.keys(TOOL_ASSET_MIME)) expect(checkToolOutput({ size: 5, type })).toBeNull();
  });

  it('targets the owner\'s personal workspace and never a shared one', () => {
    expect(pickTargetWorkspace([
      { id: 'shared', is_personal: false, role: 'owner' },
      { id: 'mine', is_personal: true, role: 'owner' },
      { id: 'other-personal', is_personal: true, role: 'member' },
    ])).toBe('mine');
    expect(pickTargetWorkspace([{ id: 'shared', is_personal: false, role: 'owner' }])).toBeNull();
    expect(pickTargetWorkspace([])).toBeNull();
  });
});

describe('image-converter outputs', () => {
  it('accepts converter images but refuses a PDF (the library stores images only)', () => {
    expect(checkToolOutput({ size: 10, type: 'image/webp' })).toBeNull();
    expect(checkToolOutput({ size: 10, type: 'application/pdf' })).toBe('type');
  });
});

describe('toolAssetFilename', () => {
  it('names the file from the source and tool, with the extension taken from the real MIME type', () => {
    expect(toolAssetFilename('portrait.jpg', 'background-remover', 'image/png')).toBe('portrait - Background Remover.png');
    expect(toolAssetFilename('logo', 'svg-converter', 'image/svg+xml')).toBe('logo - SVG Converter.svg');
    expect(toolAssetFilename('shot.PNG', 'halftone', 'image/jpeg')).toBe('shot - Halftone.jpg');
    expect(toolAssetFilename('scan.pdf', 'image-converter', 'image/webp')).toBe('scan - Image Converter.webp');
  });

  it('strips path-like and unsafe characters and bounds the length', () => {
    const name = toolAssetFilename('../../etc/pass<wd>|"x".png', 'halftone', 'image/png');
    expect(name).not.toMatch(/[\\/<>|"]/);
    expect(name.endsWith(' - Halftone.png')).toBe(true);
    expect(toolAssetFilename('a'.repeat(300), 'halftone', 'image/png').length).toBeLessThanOrEqual(60 + ' - Halftone.png'.length);
  });

  it('falls back safely for empty or unknown input', () => {
    expect(toolAssetFilename('', 'halftone', 'image/png')).toBe('untitled - Halftone.png');
    expect(toolAssetFilename('   ', 'halftone', 'image/png')).toBe('untitled - Halftone.png');
    expect(toolAssetFilename('x', 'halftone', 'application/x-evil')).toBe('x - Halftone.png');
  });

  it('keeps non-latin names readable', () => {
    expect(toolAssetFilename('पोस्टर.png', 'halftone', 'image/png')).toBe('पोस्टर - Halftone.png');
  });
});
