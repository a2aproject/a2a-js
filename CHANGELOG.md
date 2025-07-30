# Changelog

## [0.2.5](https://github.com/a2aproject/a2a-js/compare/v0.2.4...v0.2.5) (2025-07-30)


### Features

* add support for custom agent card url. resolves [#68](https://github.com/a2aproject/a2a-js/issues/68) ([#79](https://github.com/a2aproject/a2a-js/issues/79)) ([dc92d32](https://github.com/a2aproject/a2a-js/commit/dc92d321ac7c142ff5232cdca0db8a24b4d76da0))
* Export ExecutionEventQueue in server ([#61](https://github.com/a2aproject/a2a-js/issues/61)) ([530c0b9](https://github.com/a2aproject/a2a-js/commit/530c0b9f1fd50fafd991f640c119837860ae8c3f))
* Export type AgentExecutionEvent ([#66](https://github.com/a2aproject/a2a-js/issues/66)) ([f4c81f4](https://github.com/a2aproject/a2a-js/commit/f4c81f41866c24d83823b5db7d24b5fdb56b37b4))


### Bug Fixes

* correct the example code ([#64](https://github.com/a2aproject/a2a-js/issues/64)) ([126eee4](https://github.com/a2aproject/a2a-js/commit/126eee4e3b79e9475a5af5cbebb0e98b68f286fa))
* setting context id in _createRequestContext ([#49](https://github.com/a2aproject/a2a-js/issues/49)) ([1abc8a1](https://github.com/a2aproject/a2a-js/commit/1abc8a1f3590f78647d94c5a1e31444203e1131f))

## [0.2.4](https://github.com/a2aproject/a2a-js/compare/v0.2.3...v0.2.4) (2025-07-14)


### Miscellaneous Chores

* fix empty npm publish by version-bump ([#56](https://github.com/a2aproject/a2a-js/issues/56)) ([b12e033](https://github.com/a2aproject/a2a-js/commit/b12e033ed8ffc823672d68d749344247ee0914ee))

## [0.2.3](https://github.com/a2aproject/a2a-js/compare/v0.2.2...v0.2.3) (2025-07-14)


### ⚠ BREAKING CHANGES

* separate entrypoints for client, server & common

### Features

* add CommonJS support alongside ESM ([#27](https://github.com/a2aproject/a2a-js/issues/27)) ([1b3e516](https://github.com/a2aproject/a2a-js/commit/1b3e516e2ba6058eddd84943b07616cf5b74f5b0))
* Allow adding middlewares in server ([#51](https://github.com/a2aproject/a2a-js/issues/51)) ([b4fc323](https://github.com/a2aproject/a2a-js/commit/b4fc323c1f607622ee7841c95c1e401cf79df186))
* separate entrypoints for client, server & common ([e8dd025](https://github.com/a2aproject/a2a-js/commit/e8dd0250847c1e628a1c932f1ba4cc5c57064714))

## [0.2.2](https://github.com/google-a2a/a2a-js/compare/v0.2.1...v0.2.2) (2025-06-20)


### Features

* add action to publish to npm ([e4ab96e](https://github.com/google-a2a/a2a-js/commit/e4ab96ed4f875cc3079534637fbf88f9adad7f74))
* add sample agent ([#19](https://github.com/google-a2a/a2a-js/issues/19)) ([1f21a0a](https://github.com/google-a2a/a2a-js/commit/1f21a0a8662550547c1703d33e71f5cf7bd28d6b))
* add test coverage ([#20](https://github.com/google-a2a/a2a-js/issues/20)) ([7bde9cd](https://github.com/google-a2a/a2a-js/commit/7bde9cd839c015e270719d312df18ddc0c6f34b0))
* generate types from spec & use unknown in types ([#17](https://github.com/google-a2a/a2a-js/issues/17)) ([748f928](https://github.com/google-a2a/a2a-js/commit/748f9283a8e93d6104e29309f27d83fb2f9193e0))
* reject sendMessage for tasks in terminal states ([#29](https://github.com/google-a2a/a2a-js/issues/29)) ([9f86195](https://github.com/google-a2a/a2a-js/commit/9f86195d01fada7f041df0199cf93bcff2da8b80))
* Supply taskId & contextId in requestContext ([#22](https://github.com/google-a2a/a2a-js/issues/22)) ([79db7f4](https://github.com/google-a2a/a2a-js/commit/79db7f48cac482b176f2297ca374e1e937eda1d0))
* support non-blocking message send ([#28](https://github.com/google-a2a/a2a-js/issues/28)) ([6984dbb](https://github.com/google-a2a/a2a-js/commit/6984dbb3655a71bb540e6c14cb2f4792a4556fad))
* use string union instead of enums ([#24](https://github.com/google-a2a/a2a-js/issues/24)) ([bcc1f7e](https://github.com/google-a2a/a2a-js/commit/bcc1f7e0e14065163dacf3f60e74c7bb501f243e))

## 0.2.1 (2025-06-06)


### Features

* Add cancelTask to executor & finished to eventBus ([831c393](https://github.com/google-a2a/a2a-js/commit/831c3937ba59e0b4c2fdfd9577f506921929034a))
* Add sdk files for client & server ([00fe8cd](https://github.com/google-a2a/a2a-js/commit/00fe8cd33db4d5464a320dc2d16fd483b5a2fbbf))
* add sdk/tests for client & server ([a921c98](https://github.com/google-a2a/a2a-js/commit/a921c98946ba4e0636d9d6d320918e1fcb3ba5aa))
* add tests for all APIs ([e6281ca](https://github.com/google-a2a/a2a-js/commit/e6281caa131ebcc247cf750f597ead2ea28f2c3d))


### Bug Fixes

* library should released as 0.2.1 ([#8](https://github.com/google-a2a/a2a-js/issues/8)) ([0335732](https://github.com/google-a2a/a2a-js/commit/033573295e0ab8115d2fcd0c64a0bd5df1537b67))
