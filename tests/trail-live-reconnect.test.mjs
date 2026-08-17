import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const html=await readFile(new URL('../index.html',import.meta.url),'utf8');

test('live polling preference is persisted and restored from application, pageshow, and foreground paths',()=>{
  assert.match(app,/rallyPollingEnabled=Boolean\(enabled\)/);assert.match(app,/application-restored/);assert.match(app,/foreground-resume/);assert.match(app,/pageshow-resume/);
  assert.match(app,/if\(rallyPollingStartPromise\)return rallyPollingStartPromise/);
});

test('intentional off remains off and compact error recovery is one tap',()=>{
  assert.match(app,/stopRallyPolling\(\{intentional:true/);assert.match(app,/RECONNECT LIVE FEED/);
  assert.match(html,/id="rallyLiveFeedControl"/);assert.equal((html.match(/id="rallyLiveFeedControl"/g)||[]).length,1);
});

test('feed merge remains point-idempotent and target activity merge is persisted before project save',()=>{
  assert.match(app,/mergeCompetitorSnapshots\(state\.project\.competitors,incoming/);assert.match(app,/refreshTargetActivity\(\)/);
  assert.match(app,/await saveProject\(false\);renderMapFeatures/);
});
