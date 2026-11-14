/** Unit-track spelling shared by booking context and native calibration guards. */
export function levelUnitTracks(level:string):string[]{return [...level.matchAll(/[345]\s*יח(?:ידות|["״']?ל)?/gu)].map(match=>match[0]);}
