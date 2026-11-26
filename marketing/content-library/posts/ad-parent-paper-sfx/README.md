# Parent ad: SFX-only comparison

Lior liked the complete silent parent ad and requested sound on top. This candidate adds six restrained cues: three paper movements, the first result, the final answer and the booking action. No visual, timing, copy, narration or music change is part of this comparison.

The source parent is P004-57c872602173b78dcb7d. `build-audio.py` reads `sound-plan.json`, mixes the two licensed recordings, and copies the parent's compressed video stream into a new AAC-audio MP4. Its450 decoded video frames are compared against that exact parent. The editable HyperFrames source includes the same mixed track.

```sh
python3 marketing/content-library/posts/ad-parent-paper-sfx/build-audio.py --video marketing/content-library/outputs/orchestration/artifacts/P004-57c872602173b78dcb7d/asset.mp4
```

Source/rights and any trimming are recorded in [credits](assets/sfx/CREDITS.md) and [asset ledger](assets/sfx/ASSETS.json). Both selected sounds are CC0. Unselected retrievals remain private outside the delivered source.

The old silent-only director is not claimed to have approved this audio. This pass uses full decoding, exact visual identity, cue/level/peak measurements and human listening. Meter readings do not establish that the sound is appealing; owner listening remains pending. Preserve the silent control and attach any audio feedback to the new exact candidate.
