#!/usr/bin/env bash
set -euo pipefail
# Run from the source checkout matching the image. Docker also supports a
# remote staging daemon via DOCKER_HOST. Only tracked test inputs travel.
cd "$(git rev-parse --show-toplevel)"
if [[ ${1:-} == --staging ]]; then
  export DOCKER_HOST=${DOCKER_HOST:-ssh://mea}
  image=$(docker inspect --format '{{.Image}}' meabeclick-staging-app-1)
else
  image=${1:?Pass --staging or a release image}
fi
export COPYFILE_DISABLE=1
git ls-files -z -- tests/characterization/{student-games.test,harness}.mjs \
  tests/{simulated-lesson-review,visual-deck-fixture,central-drive-fixture,lesson-provider-preload,lesson-author-fixture,learning-archive-fixture}.mjs \
  tests/unit/native-homework-share.test.mjs |
  tar -czf - --null -T - |
  docker run --rm -i --env TEST_RELEASE_IMAGE=1 --network none --tmpfs /tmp:exec "$image" sh -ec '
    mkdir /tmp/lesson && cd /tmp/lesson
    tar xzf -
    for dir in node_modules build static templates; do ln -s "/app/$dir" "$dir"; done
    node --test tests/characterization/student-games.test.mjs tests/unit/native-homework-share.test.mjs
  '
