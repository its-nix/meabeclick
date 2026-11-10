#!/usr/bin/env node
import {writeFile,rename,rm,mkdtemp} from 'node:fs/promises';import {dirname,join,resolve} from 'node:path';
import {readCandidate,normalized} from './visual-pilot-validation.mjs';
import {renderVisualDeck} from '../src/lib/server/visual-deck-render.ts';
const args=process.argv.slice(2),opts={};for(let i=0;i<args.length;i++){const k=args[i];if(!['--from','--out'].includes(k)||opts[k]||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: --from <sealed-candidate> [--out <corpus.json>]');opts[k]=args[++i];}if(!opts['--from'])throw Error('--from required');
const candidate=await readCandidate(resolve(opts['--from']));for(const view of ['lesson','presenter','homework'])renderVisualDeck(candidate.bundle,{view});for(const game of candidate.bundle.games)renderVisualDeck(candidate.bundle,{view:'game',gameId:game.id});
const dest=resolve(opts['--out']??'src/lib/server/learning-pilot-corpus.json'),temp=await mkdtemp(join(dirname(dest),'.pilot-package-'));try{const file=join(temp,'corpus.json');await writeFile(file,normalized(candidate));await rename(file,dest);}finally{await rm(temp,{recursive:true,force:true});}console.log('Packaged protected review: '+dest);
