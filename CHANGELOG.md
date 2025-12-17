# Changelog

## [0.3.7](https://github.com/a2aproject/a2a-js/compare/v0.3.6...v0.3.7) (2025-12-17)


### Features

* add rest client ([#258](https://github.com/a2aproject/a2a-js/issues/258)) ([96be3a1](https://github.com/a2aproject/a2a-js/commit/96be3a1d6caa3f55673e0c0e77859fe064beab2d))
* remove EventEmitter dependency to support Edge Runtime ([#219](https://github.com/a2aproject/a2a-js/issues/219)) ([6c76fef](https://github.com/a2aproject/a2a-js/commit/6c76fef26473d8b15d729040b6c474de2794c7fe)), closes [#218](https://github.com/a2aproject/a2a-js/issues/218)


### Bug Fixes

* export transport agnostic errors from client ([#272](https://github.com/a2aproject/a2a-js/issues/272)) ([23cd42e](https://github.com/a2aproject/a2a-js/commit/23cd42e83d6510b54b013df2efd762017f47d2a1))
* pass ServerCallContext to getAuthenticatedExtendedAgentCard for REST ([#274](https://github.com/a2aproject/a2a-js/issues/274)) ([89b141b](https://github.com/a2aproject/a2a-js/commit/89b141b5ba915c53c04b2ffb1632e673b3adaace)), closes [#137](https://github.com/a2aproject/a2a-js/issues/137)

## [0.3.6](https://github.com/a2aproject/a2a-js/compare/v0.3.5...v0.3.6) (2025-12-10)


### Features

* add support for extendedAgentCard on client side ([#234](https://github.com/a2aproject/a2a-js/issues/234)) ([3073376](https://github.com/a2aproject/a2a-js/commit/3073376f7c311f0c13c51c129d7065249735517a))
* Add support for extension headers on client side ([#227](https://github.com/a2aproject/a2a-js/issues/227)) ([8c57002](https://github.com/a2aproject/a2a-js/commit/8c57002add3b25387da899df7a610098b0f4e01b))
* implement client interceptors ([#223](https://github.com/a2aproject/a2a-js/issues/223)) ([5694c22](https://github.com/a2aproject/a2a-js/commit/5694c22e3bccba87137c5b4ad1b3011f9e30dcd0))
* Implement extended card support on server side ([#197](https://github.com/a2aproject/a2a-js/issues/197)) ([45014ac](https://github.com/a2aproject/a2a-js/commit/45014ac4a192ad3c6120849577530d1d63eb27b8))
* implement server http+json ([#142](https://github.com/a2aproject/a2a-js/issues/142)) ([f20e662](https://github.com/a2aproject/a2a-js/commit/f20e66247d3c962144d77e98e7720d6041537533))
* introduce AgentCardResolver ([#225](https://github.com/a2aproject/a2a-js/issues/225)) ([ddaf7de](https://github.com/a2aproject/a2a-js/commit/ddaf7ded169ccc285051eeb63088dc697e6ae93e))
* introduce transport agnostic client ([#198](https://github.com/a2aproject/a2a-js/issues/198)) ([94a9848](https://github.com/a2aproject/a2a-js/commit/94a98483998a62669140de9bfbdde483787fa065))
* server side support for extensions ([5ef7396](https://github.com/a2aproject/a2a-js/commit/5ef73960758b78ed2a52356a10cb35cadeb440bd))
* support authentication on server side ([#195](https://github.com/a2aproject/a2a-js/issues/195)) ([9872d93](https://github.com/a2aproject/a2a-js/commit/9872d93622e12efb7369d7e658cec7ab4fd8590c))


### Bug Fixes

* handle errors occurred in non-blocking sendMessage ([#187](https://github.com/a2aproject/a2a-js/issues/187)) ([e55c0f4](https://github.com/a2aproject/a2a-js/commit/e55c0f4791b556cc42e256073cf9018d1ec18cca))


### Miscellaneous Chores

* set version to 0.3.6 ([#191](https://github.com/a2aproject/a2a-js/issues/191)) ([3f8cea0](https://github.com/a2aproject/a2a-js/commit/3f8cea066efa59ae38ac405801884b9b5037841b))

## [0.3.5](https://github.com/a2aproject/a2a-js/compare/v0.3.4...v0.3.5) (2025-11-05)


### Bug Fixes

* cancel/task now returns the expected 'cancelled' task status ([#158](https://github.com/a2aproject/a2a-js/issues/158)) ([3eec0bd](https://github.com/a2aproject/a2a-js/commit/3eec0bd98ab02f8d76c4b01dc8ea8351bc8f1a07))
* correct the default value in the agentCardPath comment ([#130](https://github.com/a2aproject/a2a-js/issues/130)) ([3279c7b](https://github.com/a2aproject/a2a-js/commit/3279c7bf4de088950c81aaeccb1cfaca5ee26284))
* enable follow up task issue on non blocking request ([#160](https://github.com/a2aproject/a2a-js/issues/160)) ([352dc05](https://github.com/a2aproject/a2a-js/commit/352dc0585122db341da93b5fbd2f8cf7acf7fcca))
* ensure push notifications order ([#141](https://github.com/a2aproject/a2a-js/issues/141)) ([22360e6](https://github.com/a2aproject/a2a-js/commit/22360e6ba735b10c611b5881ea8f98c898622117))
* ensure user messages are added to existing tasks ([#138](https://github.com/a2aproject/a2a-js/issues/138)) ([00fb916](https://github.com/a2aproject/a2a-js/commit/00fb916ca4b877b11b3153d67593027e508c3d64))
* validate JSON-RPC params ([#155](https://github.com/a2aproject/a2a-js/issues/155)) ([5b39f4d](https://github.com/a2aproject/a2a-js/commit/5b39f4dd96b619e1683c0f2226279d20572f2a27))
* validate JSON-RPC request id according to the spec ([#152](https://github.com/a2aproject/a2a-js/issues/152)) ([9558c36](https://github.com/a2aproject/a2a-js/commit/9558c3613a0e5c8c48743412b0c47f9480345666))

## [0.3.4](https://github.com/a2aproject/a2a-js/compare/v0.3.3...v0.3.4) (2025-09-04)


### Features

* add list and delete task push notification config rpc method and custom rpc methods for extensions  ([#119](https://github.com/a2aproject/a2a-js/issues/119)) ([26c4e7d](https://github.com/a2aproject/a2a-js/commit/26c4e7df48e0cd1088a9340ddc34bfbed320664c))
* Added push notifications support ([#108](https://github.com/a2aproject/a2a-js/issues/108)) ([45a211a](https://github.com/a2aproject/a2a-js/commit/45a211a738ea7770ec5ee8b10a1238060ba7a471))


### Miscellaneous Chores

* release 0.3.4 ([#128](https://github.com/a2aproject/a2a-js/issues/128)) ([41791d9](https://github.com/a2aproject/a2a-js/commit/41791d99a4c7776ac3ee183d3e834df31a2020ac))

## [0.3.3](https://github.com/a2aproject/a2a-js/compare/v0.3.2...v0.3.3) (2025-08-27)


### ⚠ BREAKING CHANGES

* Update A2AClient constructor to initialize with full agentCardUrl ([#121](https://github.com/a2aproject/a2a-js/issues/121))

### Features

* Update A2AClient constructor to initialize with full agentCardUrl ([#121](https://github.com/a2aproject/a2a-js/issues/121)) ([755044c](https://github.com/a2aproject/a2a-js/commit/755044c6c610991b5c86747da72b24e1fff9ade3))


### Bug Fixes

* Improve fetch implementation handling ([#117](https://github.com/a2aproject/a2a-js/issues/117)) ([09adbd3](https://github.com/a2aproject/a2a-js/commit/09adbd31d1ef7a73e4c8c87045af84bb1280226f))


### Miscellaneous Chores

* release 0.3.3 ([#124](https://github.com/a2aproject/a2a-js/issues/124)) ([ea59193](https://github.com/a2aproject/a2a-js/commit/ea591932901742af76afb5aeee4cf8d27cc9a6c2))

## [0.3.2](https://github.com/a2aproject/a2a-js/compare/v0.3.1...v0.3.2) (2025-08-17)


### Features

* Added generic client hooks for HTTP based authentication, and improved agent.json resolution ([#33](https://github.com/a2aproject/a2a-js/issues/33)) ([a9826ac](https://github.com/a2aproject/a2a-js/commit/a9826acde3bb1f741153407e6179fd21f2e7a4bb))


### Bug Fixes

* fix Incorrect Well-Known Path for Agent Card ([#102](https://github.com/a2aproject/a2a-js/issues/102)) ([3a0f1d0](https://github.com/a2aproject/a2a-js/commit/3a0f1d07843b725c9beaf1078bc43418ff2871ed))


### Miscellaneous Chores

* release 0.3.2 ([#111](https://github.com/a2aproject/a2a-js/issues/111)) ([03f35e0](https://github.com/a2aproject/a2a-js/commit/03f35e0ed29d2b24df7eddb2a7fe21d0690f503e))

## [0.3.1](https://github.com/a2aproject/a2a-js/compare/v0.3.0...v0.3.1) (2025-08-06)


### Bug Fixes

* add missing express entrypoint to tsup config ([#96](https://github.com/a2aproject/a2a-js/issues/96)) ([8e990e4](https://github.com/a2aproject/a2a-js/commit/8e990e497927e3554699f8ebb005829b170d9bc3))

## [0.3.0](https://github.com/a2aproject/a2a-js/compare/v0.2.5...v0.3.0) (2025-08-05)


### ⚠ BREAKING CHANGES

* upgrade to a2a 0.3.0 spec version ([#87](https://github.com/a2aproject/a2a-js/issues/87))
* make Express dependency optional

### Features

* make Express dependency optional ([60899c5](https://github.com/a2aproject/a2a-js/commit/60899c51e2910570402d1207f6b50952bed8862f))
* upgrade to a2a 0.3.0 spec version ([#87](https://github.com/a2aproject/a2a-js/issues/87)) ([ae53da1](https://github.com/a2aproject/a2a-js/commit/ae53da1e36ff58912e01fefa854c5b3174edf7d8))

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
