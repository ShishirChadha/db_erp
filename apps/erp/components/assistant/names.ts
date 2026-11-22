// "DB" is a hard word for speech recognisers: these are the ways it comes back
// (IDBI, TP, TV, the bee...). Used by the wake listener (useVoice.ts) and the
// free instant replies (instant-replies.ts). No imports, so both can use it.
export const NAME_VARIANTS = [
  'db', 'd b', 'dee bee', 'deebee', 'dbi', 'idbi', 'i d b i', 'debi', 'debbie', 'debby', 'deby', 'dibi', 'divi', 'deepi', 'deepu', 'dipi',
  'tp', 't p', 'tb', 't b', 'dp', 'd p', 'tv', 'pb', 'bb', 'vb', 'the bee', 'the b', 'thee bee', 'deeby',
  'डीबी', 'डी बी', 'टीपी', 'दीबी', 'डेबी',
]
