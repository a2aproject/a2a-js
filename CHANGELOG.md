# Changelog

## [1.0.0](https://github.com/a2aproject/a2a-js/compare/v1.0.0-beta.0...v1.0.0) (2026-07-22)

`@a2a-js/sdk` is now generally available. This release promotes the v1.0 line to stable, implementing the full [A2A Protocol Specification v1.0](https://a2a-protocol.org/v1.0.0/specification/) across all three transports (JSON-RPC, HTTP+JSON/REST, gRPC), with opt-in v0.3 backward compatibility for staged migrations.

Upgrading from `0.3.x`? See the [v0.3 → v1.0 migration guide](https://github.com/a2aproject/a2a-js/blob/v1.0.0/docs/migration-guide.md).
Interoperating with peers still on v0.3? See the [end-user v0.3 compatibility guide](https://github.com/a2aproject/a2a-js/blob/v1.0.0/docs/compatibility-v0_3.md).

Changes below cover what landed since `v1.0.0-beta.0` — for the complete v0.3 → v1.0 delta, see the [`1.0.0-beta.0`](#100-beta0-2026-07-01) and [`1.0.0-alpha.0`](#100-alpha0-2026-05-11) entries below.


### ⚠ BREAKING CHANGES

* unify A2AError hierarchy with transport specific subclasses ([#587](https://github.com/a2aproject/a2a-js/issues/587))
* **server:** replace individual properties with SendMessageRequest in RequestContext ([#581](https://github.com/a2aproject/a2a-js/issues/581))

### Features

* add state bag and ServerCallContextBuilder to ServerCallContext ([#364](https://github.com/a2aproject/a2a-js/issues/364)) ([477e394](https://github.com/a2aproject/a2a-js/commit/477e394981a92a118f3a738a0401fc45193612da))
* export SSE wire-format helpers from public entry point ([#548](https://github.com/a2aproject/a2a-js/issues/548)) ([8bc21f5](https://github.com/a2aproject/a2a-js/commit/8bc21f5697f4b3ea31a1788747db418e6619809f)), closes [#547](https://github.com/a2aproject/a2a-js/issues/547)
* **server:** expose SendMessageRequest metadata to AgentExecutor via RequestContext ([#564](https://github.com/a2aproject/a2a-js/issues/564)) ([a92f54e](https://github.com/a2aproject/a2a-js/commit/a92f54ec6ea5aa0c3d13891fd4ad110e97b07e93))
* **server:** replace individual properties with SendMessageRequest in RequestContext ([#581](https://github.com/a2aproject/a2a-js/issues/581)) ([7cd30de](https://github.com/a2aproject/a2a-js/commit/7cd30dea0082e2d1491f1ec4e037e06b2e408462))
* unify A2AError hierarchy with transport specific subclasses ([#587](https://github.com/a2aproject/a2a-js/issues/587)) ([4806f8f](https://github.com/a2aproject/a2a-js/commit/4806f8f757c7b945d1d588804cbfe06fc2d30a10))


### Bug Fixes

* **client:** bound SSE event size to prevent client-side memory exhaustion ([#582](https://github.com/a2aproject/a2a-js/issues/582)) ([e6e8ce9](https://github.com/a2aproject/a2a-js/commit/e6e8ce9af036f10ca020286fe4bfa649994e7b84))
* **client:** cancel the SSE stream on teardown to avoid leaking connections ([#580](https://github.com/a2aproject/a2a-js/issues/580)) ([83269a5](https://github.com/a2aproject/a2a-js/commit/83269a5a30f7a4860df80fe12f80d8f2d532e8cf))
* **grpc:** preserve null values in protobuf Struct ([#578](https://github.com/a2aproject/a2a-js/issues/578)) ([f447e4e](https://github.com/a2aproject/a2a-js/commit/f447e4e72332fd9f5aa32ba3fccd1464d2de4627)), closes [#576](https://github.com/a2aproject/a2a-js/issues/576)
* resolve sdk compatibility bugs ([#568](https://github.com/a2aproject/a2a-js/issues/568)) ([b57f026](https://github.com/a2aproject/a2a-js/commit/b57f026f82b022eee16bd09907a9ecac0162784f))
* **server:** await _handleProcessingError so blocking drains surface errors ([#579](https://github.com/a2aproject/a2a-js/issues/579)) ([5833652](https://github.com/a2aproject/a2a-js/commit/5833652fbe4eab1a3d10437b2d6db7b0fe22233f))
* support GET for resubscribe route ([#569](https://github.com/a2aproject/a2a-js/issues/569)) ([8dd43d1](https://github.com/a2aproject/a2a-js/commit/8dd43d1484bb7bf4dfc786eca1c4ce2d40441d73))


## [1.0.0-beta.0](https://github.com/a2aproject/a2a-js/compare/v1.0.0-alpha.0...v1.0.0-beta.0) (2026-07-01)

The v0.3 backward-compatibility layer is now complete, marking this release as the first one bringing v1.0 and v0.3 support together.
Backward compatibility with v0.3 was implemented across all three transports (JSON-RPC, REST, gRPC), agent-card resolution, and push notifications — closing [#452](https://github.com/a2aproject/a2a-js/issues/452).
A v1.0 server can transparently accept v0.3 clients (and a v1.0 client can talk to v0.3 servers) by opting in with `legacyCompat: { enabled: true }` on the relevant transport.

See the [v0.3 → v1.0 migration guide](https://github.com/a2aproject/a2a-js/blob/v1.0.0-beta.0/docs/migration-guide.md)
and the [end-user v0.3 compatibility guide](https://github.com/a2aproject/a2a-js/blob/v1.0.0-beta.0/docs/compatibility-v0_3.md).


### Features

* add compat-v1 client and server samples to demonstrate A2A v0.3 backward compatibility ([#520](https://github.com/a2aproject/a2a-js/issues/520)) ([fce0b3f](https://github.com/a2aproject/a2a-js/commit/fce0b3f8d89e80b1ad006bfb799e262e991977e9))
* add opt-in legacy v0.3 compatibility to JSON-RPC handler and improve extension header support ([#501](https://github.com/a2aproject/a2a-js/issues/501)) ([f707350](https://github.com/a2aproject/a2a-js/commit/f70735090a6e27bbc0313c6b4d710f26a92e7b39))
* add v0.3 compatibility layer for client and server agent-card handling ([#504](https://github.com/a2aproject/a2a-js/issues/504)) ([75685f2](https://github.com/a2aproject/a2a-js/commit/75685f2ce0a3c3ba970c000cf0935d9df3b0bbcb))
* add v0.3 gRPC compat layer ([#505](https://github.com/a2aproject/a2a-js/issues/505)) ([314d9e3](https://github.com/a2aproject/a2a-js/commit/314d9e36946d52c3c20c8f55fac77a2a715fb4fb))
* default to v0.3 if version not provided ([#511](https://github.com/a2aproject/a2a-js/issues/511)) ([ad7f772](https://github.com/a2aproject/a2a-js/commit/ad7f772308472c770d0ef65a23f939966741eb82))
* defined compat-specific consts and mappings ([#478](https://github.com/a2aproject/a2a-js/issues/478)) ([db0c595](https://github.com/a2aproject/a2a-js/commit/db0c595581e833be86fe20d9e84b22ec6a5296e3))
* implement legacy v0.3 JSON-RPC transport handler ([#493](https://github.com/a2aproject/a2a-js/issues/493)) ([d191d91](https://github.com/a2aproject/a2a-js/commit/d191d911479380a0fa0eca9ca4a2975d530143e6))
* implement legacy v0.3 REST support with compatible transport handler and middleware routing ([#495](https://github.com/a2aproject/a2a-js/issues/495)) ([da9a968](https://github.com/a2aproject/a2a-js/commit/da9a9682a34e73578ebed75813afa2fd4e15d241))
* implement v0.3 ITK cross-SDK validation workflows ([#513](https://github.com/a2aproject/a2a-js/issues/513)) ([c9385f3](https://github.com/a2aproject/a2a-js/commit/c9385f338863000a158ac030614e1821a3355ccb))
* implement v0.3 JSON-RPC client transport ([#499](https://github.com/a2aproject/a2a-js/issues/499)) ([46aa5d6](https://github.com/a2aproject/a2a-js/commit/46aa5d6fe984f01c3d078342eefcd0f6af6eb9d4))
* implement v0.3 protocol compatibility for RestTransportFactory ([#503](https://github.com/a2aproject/a2a-js/issues/503)) ([b172482](https://github.com/a2aproject/a2a-js/commit/b172482821c41ed88d85698e02b49754100170cf))
* implement versioned push notification serializers with legacy v0.3 compatibility support ([#507](https://github.com/a2aproject/a2a-js/issues/507)) ([0261be8](https://github.com/a2aproject/a2a-js/commit/0261be8585714ba9804a6ad8cb3eb4578404c21c))
* normalize extension headers based on negotiated protocol version ([#510](https://github.com/a2aproject/a2a-js/issues/510)) ([74a51ee](https://github.com/a2aproject/a2a-js/commit/74a51eee0b7cc0c708bbca4799a777f1d47530a9))
* replace automatic v0.3 agent card synthesis with explicit per-interface advertisement ([#560](https://github.com/a2aproject/a2a-js/issues/560)) ([60ad3b2](https://github.com/a2aproject/a2a-js/commit/60ad3b2b6aa1cce70a372dcf5c63ac46a1059544))


### Bug Fixes

* **compat:** wrap primitive Part.data values instead of throwing ([#537](https://github.com/a2aproject/a2a-js/issues/537)) ([7647db5](https://github.com/a2aproject/a2a-js/commit/7647db51720b7f64a6df86d829627c207debaf3b))
* **server/rest:** handle undefined historyLength to return full task history ([#527](https://github.com/a2aproject/a2a-js/issues/527)) ([fa9ebce](https://github.com/a2aproject/a2a-js/commit/fa9ebcef97ddf2bbedb4fbe42822cde8b145b66e)), closes [#535](https://github.com/a2aproject/a2a-js/issues/535)
* **server:** handle AUTH_REQUIRED lifecycle per spec ([#523](https://github.com/a2aproject/a2a-js/issues/523)) ([68826c2](https://github.com/a2aproject/a2a-js/commit/68826c251a4bc789cbbdf2904c66eeb61cbb3715))
* **server:** make cancelTask idempotent on the canceled state ([#545](https://github.com/a2aproject/a2a-js/issues/545)) ([1d17a78](https://github.com/a2aproject/a2a-js/commit/1d17a78d8c42b84fdf84c8e6a6a7c99b794e6b63))
* **server:** make push notification config id optional with server-side UUID ([#543](https://github.com/a2aproject/a2a-js/issues/543)) ([83af8c3](https://github.com/a2aproject/a2a-js/commit/83af8c37eaffd6200721bc73beae85993567d41d))
* **server:** merge Task history in ResultManager instead of overwriting ([#524](https://github.com/a2aproject/a2a-js/issues/524)) ([4e1d4f7](https://github.com/a2aproject/a2a-js/commit/4e1d4f75d0d468776a31e44b378013f098ccaf78)), closes [#532](https://github.com/a2aproject/a2a-js/issues/532)
* **server:** preserve activated extensions in response header ([#544](https://github.com/a2aproject/a2a-js/issues/544)) ([26184b4](https://github.com/a2aproject/a2a-js/commit/26184b4aec53106a4d5c73a6ed76f1a46bf1ecba))
* **server:** propagate return to SSE generators to prevent listener leaks ([#526](https://github.com/a2aproject/a2a-js/issues/526)) ([a690734](https://github.com/a2aproject/a2a-js/commit/a6907348c3160331e37985c181bd9fff968d10b6)), closes [#534](https://github.com/a2aproject/a2a-js/issues/534)
* **server:** synthesize correct error Task id in blocking and streaming paths ([#525](https://github.com/a2aproject/a2a-js/issues/525)) ([a3dd703](https://github.com/a2aproject/a2a-js/commit/a3dd703ecc94c724e46e74097c2bb1bc2655bc8e)), closes [#533](https://github.com/a2aproject/a2a-js/issues/533)
* **server:** yield Task snapshot on resubscribe when bus is inactive ([#542](https://github.com/a2aproject/a2a-js/issues/542)) ([cd8f8fc](https://github.com/a2aproject/a2a-js/commit/cd8f8fc75b9d73cbeac07969c38d2d41bf9eb881))

## 1.0.0-alpha.0 (2026-05-11)

See the [v0.3 -> v1.0-alpha.0 migration guide](https://github.com/a2aproject/a2a-js/blob/v1.0.0-alpha.0/docs/migration-guide.md).

**Note**: Enabling backward compatibility with v0.3 is tracked in [#452](https://github.com/a2aproject/a2a-js/issues/452).


### ⚠ BREAKING CHANGES

* Drop support for node 18 ([#368](https://github.com/a2aproject/a2a-js/issues/368))
* Make ServerCallContext parameter mandatory across all places ([#405](https://github.com/a2aproject/a2a-js/issues/405))
* Remove JSON-RPC client ([#353](https://github.com/a2aproject/a2a-js/issues/353))
* Remove transport-specific exports ([#404](https://github.com/a2aproject/a2a-js/issues/404))
* Update codebase to use A2A 1.0.0 data model ([#375](https://github.com/a2aproject/a2a-js/issues/375))
* Remove A2AExpressApp ([#363](https://github.com/a2aproject/a2a-js/issues/363))

### Features

* Add A2A Version Header ([#422](https://github.com/a2aproject/a2a-js/issues/422)) ([b5f3db7](https://github.com/a2aproject/a2a-js/commit/b5f3db79240d9293f632adc3c27506a1dc15ad02))
* Add cache-headers logic to the agent card handler ([#435](https://github.com/a2aproject/a2a-js/issues/435)) ([955b52b](https://github.com/a2aproject/a2a-js/commit/955b52b77686485c6e175b6c99fbc1a42b7aa64a))
* Add resource scoping ([#450](https://github.com/a2aproject/a2a-js/issues/450)) ([c527086](https://github.com/a2aproject/a2a-js/commit/c527086b2b734ca715bc60f85bfcc0223600939d))
* Add support for custom authentication scheme and credentials in auth-headers ([#430](https://github.com/a2aproject/a2a-js/issues/430)) ([5a4389b](https://github.com/a2aproject/a2a-js/commit/5a4389bc117baf45665269c9efc5cad77a9146b1))
* AgentCardSignature support ([#448](https://github.com/a2aproject/a2a-js/issues/448)) ([4a41a8c](https://github.com/a2aproject/a2a-js/commit/4a41a8c77520c3f4baa3ba45d082fd7b35910ee0))
* Enforce events ordering ([#437](https://github.com/a2aproject/a2a-js/issues/437)) ([157cf48](https://github.com/a2aproject/a2a-js/commit/157cf48f5de41be261a8839dc44a4bbdb257182f))
* Enriched Error Model ([#427](https://github.com/a2aproject/a2a-js/issues/427)) ([c130778](https://github.com/a2aproject/a2a-js/commit/c13077801d8d300eb4f1a81ef207c7d4f0184e11))
* Implement listTasks method ([#383](https://github.com/a2aproject/a2a-js/issues/383)) ([7d4c472](https://github.com/a2aproject/a2a-js/commit/7d4c472b0a8aa957c8b5ebed0e3d7987df3282a9))
* Send current task as the first event after subscribing to it ([#418](https://github.com/a2aproject/a2a-js/issues/418)) ([4bfcf5f](https://github.com/a2aproject/a2a-js/commit/4bfcf5f3ebbbe538596d9519a1e31d79cfd6fc45))
* Support multi-tenancy ([#419](https://github.com/a2aproject/a2a-js/issues/419)) ([1877877](https://github.com/a2aproject/a2a-js/commit/18778775bb755f75d46be1039291057ece625561))

### Code Refactoring

* remove A2AExpressApp ([#363](https://github.com/a2aproject/a2a-js/issues/363)) ([0b84728](https://github.com/a2aproject/a2a-js/commit/0b84728e56241ae5b00ff3274fb91dda5121e037))

## [0.3.13](https://github.com/a2aproject/a2a-js/compare/v0.3.12...v0.3.13) (2026-03-16)


### Bug Fixes

* properly parse ProtoJSON body for POST pushNotificationConfigs ([#352](https://github.com/a2aproject/a2a-js/issues/352)) ([57696a8](https://github.com/a2aproject/a2a-js/commit/57696a8001416ae2c5c592406c1f46b3e9209eca)), closes [#336](https://github.com/a2aproject/a2a-js/issues/336)

## [0.3.12](https://github.com/a2aproject/a2a-js/compare/v0.3.11...v0.3.12) (2026-03-10)


### Bug Fixes

* Fixing missing push configuration after normalization for rest transport ([#346](https://github.com/a2aproject/a2a-js/issues/346)) ([54ac8c4](https://github.com/a2aproject/a2a-js/commit/54ac8c41cacc54fb0d80526b79c87ba3aede14af))

## [0.3.11](https://github.com/a2aproject/a2a-js/compare/v0.3.10...v0.3.11) (2026-03-10)


### Bug Fixes

* support proto-based AgentCard in AgentCardResolver ([#344](https://github.com/a2aproject/a2a-js/issues/344)) ([e71221c](https://github.com/a2aproject/a2a-js/commit/e71221cbc87b54acd96fbb4e7a46439a33ccbed6))
* throw on JSON-RPC response id mismatch ([#318](https://github.com/a2aproject/a2a-js/issues/318)) ([5ea1c94](https://github.com/a2aproject/a2a-js/commit/5ea1c94acaf2cae5aa1bc10ea5816f5400a62423))

## [0.3.10](https://github.com/a2aproject/a2a-js/compare/v0.3.9...v0.3.10) (2026-01-27)


### Bug Fixes

* do not use ReadableStream async iterator in SSE stream parsing ([#311](https://github.com/a2aproject/a2a-js/issues/311)) ([5359fa8](https://github.com/a2aproject/a2a-js/commit/5359fa802fc3a3dcf35438f3cee18f7ab9bc3ca3))
* preserve typed error as cause in SSE errors ([#315](https://github.com/a2aproject/a2a-js/issues/315)) ([d39544e](https://github.com/a2aproject/a2a-js/commit/d39544ea4ba0db004fcca15b9fac870a97725e5c))

## [0.3.9](https://github.com/a2aproject/a2a-js/compare/v0.3.8...v0.3.9) (2026-01-21)


### Features

* implement gRPC client ([#299](https://github.com/a2aproject/a2a-js/issues/299)) ([dbdb96e](https://github.com/a2aproject/a2a-js/commit/dbdb96eeb14a710ad612f36f371d848fc7cce186))
* implement gRPC server ([#279](https://github.com/a2aproject/a2a-js/issues/279)) ([bd4caa2](https://github.com/a2aproject/a2a-js/commit/bd4caa22a09480ba8cebec755528b67b80a95323))


### Bug Fixes

* use proto default values in generated a2a_types.ts ([#303](https://github.com/a2aproject/a2a-js/issues/303)) ([0215d42](https://github.com/a2aproject/a2a-js/commit/0215d4232654c356c5d48e93cb94da46093576dd))

## [0.3.8](https://github.com/a2aproject/a2a-js/compare/v0.3.7...v0.3.8) (2026-01-15)


### ⚠ BREAKING CHANGES

* use ProtoJSON for REST transport ([#292](https://github.com/a2aproject/a2a-js/issues/292))

### Features

* use case-insensitive transport protocol name comparison in ClientFactory ([5246067](https://github.com/a2aproject/a2a-js/commit/5246067f5fc1ca3aa7b1aef7176aab5b0f164acb))


### Bug Fixes

* add typesVersions to support legacy module resolution ([#288](https://github.com/a2aproject/a2a-js/issues/288)) ([6499e29](https://github.com/a2aproject/a2a-js/commit/6499e290f6e5a932eb7a6946c3b708cdea367165))
* use ProtoJSON for REST transport ([#292](https://github.com/a2aproject/a2a-js/issues/292)) ([d2efc4c](https://github.com/a2aproject/a2a-js/commit/d2efc4cf343860d25b05f064f507ef4da7bba06b))

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
