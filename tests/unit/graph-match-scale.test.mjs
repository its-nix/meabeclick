import { test } from 'node:test';
import assert from 'node:assert/strict';
import { graphRoundScale, graphPlotPoints } from '../../src/lib/games/graph-match-plot.ts';
const ys = (points) => points.split(' ').map(p=>Number(p.split(',')[1]));
test('positive proportional alternatives keep different slopes under one round scale',()=>{
 const main=[0,1,2,3,4], right=[0,.5,1,1.5,2], wrong=[0,1,2,3,4];
 const scale=graphRoundScale([main,right,wrong]);
 assert.deepEqual(scale,{lo:0,hi:4});
 const a=ys(graphPlotPoints(right,scale)),b=ys(graphPlotPoints(wrong,scale));
 assert.equal(a[0],b[0]);assert.notEqual(a.at(-1),b.at(-1));
 assert.ok(Math.abs((a[0]-a.at(-1))/(b[0]-b.at(-1))-.5)<.001);
});
test('signed proportional alternatives share their origin without collapsing amplitudes',()=>{
 const right=[-6,-3,0,3,6],wrong=[-4,-2,0,2,4];
 const scale=graphRoundScale([[-2,-1,0,1,2],right,wrong]);
 assert.deepEqual(scale,{lo:-6,hi:6});
 const a=ys(graphPlotPoints(right,scale)),b=ys(graphPlotPoints(wrong,scale));
 assert.equal(a[2],b[2]);assert.notEqual(a[0],b[0]);assert.notEqual(a.at(-1),b.at(-1));
});
test('constant zero, positive and negative graphs occupy different shared heights',()=>{
 const curves=[[0,0,0],[2,2,2],[-3,-3,-3]];
 const scale=graphRoundScale(curves);assert.deepEqual(scale,{lo:-3,hi:2});
 const heights=curves.map(c=>ys(graphPlotPoints(c,scale)));
 assert.equal(new Set(heights.map(h=>h[0])).size,3);
 assert.ok(heights.every(h=>new Set(h).size===1));
 assert.deepEqual(graphRoundScale([[0,0],[0,0]]),{lo:-1,hi:1});
});
test('one round includes main and every option, includes zero and does not mutate samples',()=>{
 const curves=[[7,8],[2,3],[20,30]];const before=structuredClone(curves);
 assert.deepEqual(graphRoundScale(curves),{lo:0,hi:30});assert.deepEqual(curves,before);
 assert.deepEqual(graphRoundScale([[-7,-8],[-2,-3]]),{lo:-8,hi:0});
 assert.doesNotMatch(graphPlotPoints([0,0],graphRoundScale([[0,0]])),/NaN|Infinity/);
});
