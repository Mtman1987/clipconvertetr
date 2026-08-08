import assert from 'node:assert/strict';
import test from 'node:test';
import { isDirectVideoUrl, isPrivateAddress } from '../src/source-security';

test('blocks private and loopback network ranges', () => {
  assert.equal(isPrivateAddress('127.0.0.1'), true);
  assert.equal(isPrivateAddress('10.20.30.40'), true);
  assert.equal(isPrivateAddress('172.16.0.1'), true);
  assert.equal(isPrivateAddress('172.31.255.255'), true);
  assert.equal(isPrivateAddress('192.168.1.2'), true);
  assert.equal(isPrivateAddress('169.254.1.2'), true);
  assert.equal(isPrivateAddress('::1'), true);
  assert.equal(isPrivateAddress('fd12::1'), true);
});

test('allows normal public network addresses', () => {
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('1.1.1.1'), false);
  assert.equal(isPrivateAddress('2606:4700:4700::1111'), false);
});

test('recognizes direct video URLs despite query strings', () => {
  assert.equal(isDirectVideoUrl('https://cdn.example/video.mp4?token=abc'), true);
  assert.equal(isDirectVideoUrl('https://cdn.example/video.webm#start'), true);
  assert.equal(isDirectVideoUrl('https://example.com/watch/123'), false);
});
