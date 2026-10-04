//! Layout of Le Mans Ultimate's built-in `LMU_Data` shared memory.
//!
//! The struct definitions below are taken from the MIT-licensed `lmu-pitwall` project
//! (https://github.com/Swizzjack/lmu-pitwall, `bridge/src/shared_memory/{types,lmu_data}.rs`,
//! Copyright (c) 2025 Swizzjack), which derived them from Studio 397's
//! `SharedMemoryInterface.hpp` and verified them against a running LMU 1.4. The compile-time
//! `assert_size!` checks below pin every embedded struct to the sizes that project verified
//! (ScoringInfo 548, VehicleScoring 584, VehicleTelemetry 1888, Wheel 260, mapping 324 820 bytes):
//! a transcription slip or a layout change breaks the build instead of producing plausible garbage.
//!
//! MIT License notice of the original: permission is granted, free of charge, to use, copy, modify
//! and distribute this code provided the copyright notice and this permission notice are included.
#![allow(non_snake_case, non_camel_case_types, dead_code)]

use std::mem::offset_of;

/// 3D double-precision vector (matches TelemVect3)
#[repr(C, packed(4))]
#[derive(Debug, Clone, Copy)]
pub struct rF2Vec3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Default for rF2Vec3 {
    fn default() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }
}

// ---------------------------------------------------------------------------
// Per-wheel telemetry  (matches rF2Wheel / TelemWheelV01)
// ---------------------------------------------------------------------------

/// rF2Wheel — per-wheel data inside rF2VehicleTelemetry
/// Wheel order in mWheels: [FL=0, FR=1, RL=2, RR=3]
///
/// NOTE: temperatures (mTemperature, mTireCarcassTemperature,
/// mTireInnerLayerTemperature) are in **Kelvin** — subtract 273.15 for Celsius.
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct rF2Wheel {
    pub mSuspensionDeflection: f64,          // meters
    pub mRideHeight: f64,                    // meters
    pub mSuspForce: f64,                     // pushrod load in Newtons
    pub mBrakeTemp: f64,                     // Kelvin. Both the rF2 SDK header and LMU's own
                                             // SharedMemoryInterface.hpp comment this as "Celsius",
                                             // but the value is Kelvin in practice — main.rs
                                             // subtracts 273.15 and the dashboard's °C thresholds
                                             // only make sense that way. See BRAKE_TEMP_K_* below.
                                             // Recheck if LMU ever fixes the header comment.
    pub mBrakePressure: f64,                 // 0.0-1.0 (future: true kPa)

    pub mRotation: f64,                      // radians/sec
    pub mLateralPatchVel: f64,               // m/s lateral velocity at contact patch
    pub mLongitudinalPatchVel: f64,          // m/s longitudinal velocity at contact patch
    pub mLateralGroundVel: f64,              // m/s lateral ground velocity
    pub mLongitudinalGroundVel: f64,         // m/s longitudinal ground velocity
    pub mCamber: f64,                        // radians
    pub mLateralForce: f64,                  // Newtons
    pub mLongitudinalForce: f64,             // Newtons
    pub mTireLoad: f64,                      // Newtons

    pub mGripFract: f64,                     // fraction of patch that is sliding (0-1)
    pub mPressure: f64,                      // kPa tire air pressure
    pub mTemperature: [f64; 3],              // Kelvin: left/center/right
    pub mWear: f64,                          // 1.0 (new) – 0.0 (destroyed) [LMU convention; inverted vs. rF2 plugin docs]
    pub mTerrainName: [u8; 16],              // material prefix from TDF
    pub mSurfaceType: u8,                    // 0=dry,1=wet,2=grass,3=dirt,4=gravel,5=rumble,6=special
    pub mFlat: u8,                           // 1 if flat
    pub mDetached: u8,                       // 1 if detached
    pub mStaticUndeflectedRadius: u8,        // tire radius in centimetres

    pub mVerticalTireDeflection: f64,        // deflection from static radius
    pub mWheelYLocation: f64,                // wheel Y relative to vehicle Y
    pub mToe: f64,                           // current toe angle (rad) w.r.t. vehicle

    pub mTireCarcassTemperature: f64,        // rough average carcass temperature (Kelvin)
    pub mTireInnerLayerTemperature: [f64; 3],// rough average inner-layer temperatures (Kelvin)

    pub mOptimalTemp: f32,                   // optimal tire temperature
    pub mCompoundIndex: u8,                  // compound index
    pub mCompoundType: u8,                   // compound type
    pub mExpansion: [u8; 18],                // reserved for future use (was 24)
}

// ---------------------------------------------------------------------------
// Vehicle telemetry (50 Hz buffer)
// ---------------------------------------------------------------------------

/// rF2VehicleTelemetry — full telemetry data for one vehicle.
///
/// Field order MUST exactly match rF2State.h / TelemInfoV01.
/// Key layout note: mWheels is at the END of the struct (after expansion bytes).
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct rF2VehicleTelemetry {
    // --- identification / timing ---
    pub mID: i32,                            // slot ID (may change post-init)
    pub mDeltaTime: f64,                     // seconds since last update
    pub mElapsedTime: f64,                   // game session time (seconds)
    pub mLapNumber: i32,                     // current lap (0-based)
    pub mLapStartET: f64,                    // elapsed time when this lap started

    pub mVehicleName: [u8; 64],              // vehicle model name
    pub mTrackName: [u8; 64],               // track name

    // --- position / kinematics ---
    pub mPos: rF2Vec3,                       // world position (metres)
    pub mLocalVel: rF2Vec3,                  // velocity in local coords (m/s)
    pub mLocalAccel: rF2Vec3,               // acceleration in local coords (m/s²)
    pub mOri: [rF2Vec3; 3],                 // orientation matrix rows (local→world)
    pub mLocalRot: rF2Vec3,                 // angular velocity in local coords (rad/s)
    pub mLocalRotAccel: rF2Vec3,            // angular acceleration in local coords (rad/s²)

    // --- powertrain / controls ---
    pub mGear: i32,                          // -1=reverse, 0=neutral, 1+=forward
    pub mEngineRPM: f64,                     // current RPM  ← BEFORE mEngineMaxRPM
    pub mEngineWaterTemp: f64,               // Celsius
    pub mEngineOilTemp: f64,                 // Celsius
    pub mClutchRPM: f64,                     // clutch-side RPM

    // raw (unfiltered) driver inputs
    pub mUnfilteredThrottle: f64,            // 0.0 – 1.0
    pub mUnfilteredBrake: f64,              // 0.0 – 1.0
    pub mUnfilteredSteering: f64,           // -1.0 (left) – 1.0 (right)
    pub mUnfilteredClutch: f64,             // 0.0 – 1.0

    // filtered / corrected inputs
    pub mFilteredThrottle: f64,              // 0.0 – 1.0
    pub mFilteredBrake: f64,                // 0.0 – 1.0
    pub mFilteredSteering: f64,             // -1.0 – 1.0
    pub mFilteredClutch: f64,              // 0.0 – 1.0

    // --- chassis / aero ---
    pub mSteeringShaftTorque: f64,          // Nm (useful for FFB)
    pub mFront3rdDeflection: f64,           // front third-spring deflection (m)
    pub mRear3rdDeflection: f64,            // rear third-spring deflection (m)

    pub mFrontWingHeight: f64,              // front wing height (m)
    pub mFrontRideHeight: f64,              // front ride height (m)
    pub mRearRideHeight: f64,               // rear ride height (m)
    pub mDrag: f64,                         // drag force (Newtons)
    pub mFrontDownforce: f64,               // front downforce (Newtons)
    pub mRearDownforce: f64,               // rear downforce (Newtons)

    // --- state / fuel ---
    pub mFuel: f64,                         // current fuel level (litres)
    pub mEngineMaxRPM: f64,                  // redline RPM  ← AFTER mFuel

    // --- vehicle state flags ---
    pub mScheduledStops: u8,                // scheduled pit stops remaining
    pub mOverheating: u8,                   // 1 if overheating icon shown
    pub mDetached: u8,                      // 1 if any part is detached
    pub mHeadlights: u8,                    // 1 if headlights on
    pub mDentSeverity: [u8; 8],            // 0=none,1=dented,2=very dented (8 locations)

    pub mLastImpactET: f64,                 // session time of last impact
    pub mLastImpactMagnitude: f64,          // magnitude of last impact
    pub mLastImpactPos: rF2Vec3,            // world position of last impact

    // --- expansion block (formerly "Expanded") ---
    pub mEngineTorque: f64,                 // engine torque at wheels (Nm)
    pub mCurrentSector: i32,               // 0=S1, 1=S2, 2=S3 (sign bit = in pitlane)
    pub mSpeedLimiter: u8,                  // 1 if pit speed limiter active
    pub mMaxGears: u8,                      // number of forward gears
    pub mFrontTireCompoundIndex: u8,        // compound index (front)
    pub mRearTireCompoundIndex: u8,         // compound index (rear)
    pub mFuelCapacity: f64,                 // tank capacity (litres)
    pub mFrontFlapActivated: u8,            // 1 if front flap activated
    pub mRearFlapActivated: u8,             // 1 if rear flap activated
    pub mRearFlapLegalStatus: u8,           // 0=disallowed,1=detected/pending,2=allowed
    pub mIgnitionStarter: u8,              // 0=off,1=ignition,2=ignition+starter
    pub mFrontTireCompoundName: [u8; 18],   // compound name (front)
    pub mRearTireCompoundName: [u8; 18],    // compound name (rear)
    pub mSpeedLimiterAvailable: u8,         // 1 if speed limiter available
    pub mAntiStallActivated: u8,           // 1 if anti-stall active
    pub mUnused: [u8; 2],
    pub mVisualSteeringWheelRange: f32,     // visual lock-to-lock range (degrees)
    pub mRearBrakeBias: f64,               // rear brake bias fraction
    pub mTurboBoostPressure: f64,           // turbo boost (bar)
    pub mPhysicsToGraphicsOffset: [f32; 3], // physics→graphics centre offset
    pub mPhysicalSteeringWheelRange: f32,   // physical lock-to-lock range (degrees)
    pub mDeltaBest: f64,                    // delta to personal best lap (seconds)

    // --- hybrid / electric motor ---
    pub mBatteryChargeFraction: f64,        // battery charge [0.0-1.0]
    pub mElectricBoostMotorTorque: f64,     // boost motor torque (Nm; negative = regen)
    pub mElectricBoostMotorRPM: f64,        // boost motor RPM
    pub mElectricBoostMotorTemperature: f64,// boost motor temperature (Celsius)
    pub mElectricBoostWaterTemperature: f64,// boost motor coolant temperature (Celsius; 0 if absent)
    pub mElectricBoostMotorState: u8,       // 0=unavailable,1=inactive,2=propulsion,3=regen

    // --- LMU v1.3: electronics / driver aids (native) ---
    pub mLapInvalidated: u8,                // 1 if current lap invalidated
    pub mABSActive: u8,                     // 1 if ABS currently intervening
    pub mTCActive: u8,                      // 1 if TC currently intervening
    pub mSpeedLimiterActive: u8,            // 1 if speed limiter currently active
    pub mWiperState: u8,                    // wiper state

    pub mTC: u8,                            // traction control level
    pub mTCMax: u8,                         // TC max level for this car
    pub mTCSlip: u8,                        // TC slip threshold
    pub mTCSlipMax: u8,                     // TC slip max
    pub mTCCut: u8,                         // TC cut level
    pub mTCCutMax: u8,                      // TC cut max

    pub mABS: u8,                           // ABS level
    pub mABSMax: u8,                        // ABS max level for this car

    pub mMotorMap: u8,                      // engine/motor map
    pub mMotorMapMax: u8,                   // motor map max

    pub mMigration: u8,                     // brake migration step
    pub mMigrationMax: u8,                  // brake migration max

    pub mFrontAntiSway: u8,                 // front anti-roll bar level
    pub mFrontAntiSwayMax: u8,              // front ARB max
    pub mRearAntiSway: u8,                  // rear anti-roll bar level
    pub mRearAntiSwayMax: u8,               // rear ARB max

    pub mLiftAndCoastProgress: u8,          // lift-and-coast progress
    pub mTrackLimitsSteps: u8,              // normalized track limits points

    pub mRegen: f32,                        // regeneration (kW)
    pub mSoC: f32,                          // state of charge
    pub mVirtualEnergy: f32,               // virtual energy fraction

    pub mTimeGapCarAhead: f32,             // time gap to car directly ahead (s)
    pub mTimeGapCarBehind: f32,            // time gap to car directly behind (s)
    pub mTimeGapPlaceAhead: f32,           // time gap to position ahead (s)
    pub mTimeGapPlaceBehind: f32,          // time gap to position behind (s)

    pub mVehicleModel: [u8; 30],            // vehicle model name
    pub mVehicleClassEnum: u8,              // IP_VehicleClass enum (0=Hypercar, 5=GT3, ...)
    pub mVehicleChampionshipEnum: u8,       // IP_VehicleChampionship enum

    pub mExpansion: [u8; 20],               // remaining future-use bytes

    // --- wheels (FL=0, FR=1, RL=2, RR=3) --- MUST BE LAST
    pub mWheels: [rF2Wheel; 4],
}

// ---------------------------------------------------------------------------
// Scoring data (5 Hz buffer)
// ---------------------------------------------------------------------------

/// rF2VehicleScoring — per-vehicle data inside rF2Scoring buffer
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct rF2VehicleScoring {
    pub mID: i32,                            // slot ID
    pub mDriverName: [u8; 32],              // driver name (UTF-8)
    pub mVehicleName: [u8; 64],             // vehicle name
    pub mTotalLaps: i16,                     // completed laps
    pub mSector: i8,                         // 0=S3, 1=S1, 2=S2 (delayed by one sector)
    pub mFinishStatus: i8,                   // 0=none,1=finished,2=DNF,3=DQ
    pub mLapDist: f64,                       // distance around track (m)
    pub mPathLateral: f64,                   // lateral offset from centre path
    pub mTrackEdge: f64,                     // track edge w.r.t. centre path
    pub mBestSector1: f64,                   // best S1 time (s)
    pub mBestSector2: f64,                   // best S2 cumulative time (s)
    pub mBestLapTime: f64,                   // best lap time (s)
    pub mLastSector1: f64,                   // last S1 time (s)
    pub mLastSector2: f64,                   // last S2 cumulative time (s)
    pub mLastLapTime: f64,                   // last lap time (s)
    pub mCurSector1: f64,                    // current S1 time (s) if valid
    pub mCurSector2: f64,                    // current S2 cumulative time (s) if valid
    pub mNumPitstops: i16,                  // pitstops made
    pub mNumPenalties: i16,                 // outstanding penalties
    pub mIsPlayer: u8,                       // 1 if this is the local player
    pub mControl: i8,                        // -1=nobody,0=local player,1=local AI,2=remote,3=replay
    pub mInPits: u8,                         // 1 if between pit_entry and pit_exit
    pub mPlace: u8,                          // 1-based race position
    pub mVehicleClass: [u8; 32],             // vehicle class name
    pub mTimeBehindNext: f64,               // gap to the car ahead (s)
    pub mLapsBehindNext: i32,              // laps behind car ahead
    pub mTimeBehindLeader: f64,            // gap to leader (s)
    pub mLapsBehindLeader: i32,            // laps behind leader
    pub mLapStartET: f64,                   // session time when this lap started
    pub mPos: rF2Vec3,                       // world position (m)
    pub mLocalVel: rF2Vec3,                 // local velocity (m/s)
    pub mLocalAccel: rF2Vec3,              // local acceleration (m/s²)
    pub mOri: [rF2Vec3; 3],                // orientation matrix rows
    pub mLocalRot: rF2Vec3,                // angular velocity in local coords (rad/s)
    pub mLocalRotAccel: rF2Vec3,           // angular acceleration in local coords (rad/s²)
    pub mHeadlights: u8,                    // headlight status
    pub mPitState: u8,                      // 0=none,1=request,2=entering,3=stopped,4=exiting
    pub mServerScored: u8,                  // 1 if scored by server
    pub mIndividualPhase: u8,              // game phase for this vehicle
    pub mQualification: i32,              // 1-based qualifying position (-1 if invalid)
    pub mTimeIntoLap: f64,                  // estimated time into current lap (s)
    pub mEstimatedLapTime: f64,             // estimated total lap time (s)
    pub mPitGroup: [u8; 24],               // pit group identifier
    pub mFlag: u8,                          // primary flag shown to this vehicle
    pub mUnderYellow: u8,                   // 1 if full-course yellow active for this car
    pub mCountLapFlag: u8,                  // dynamic blue-flag override
    pub mInGarageStall: u8,                // 1 if within allowable garage area
    pub mUpgradePack: [u8; 16],            // upgrade pack code
    pub mPitLapDist: f32,                   // pit lane distance (m)  ← f32, not f64!
    pub mBestLapSector1: f32,              // S1 time from best lap (s)  ← f32!
    pub mBestLapSector2: f32,              // S2 cumulative from best lap (s)  ← f32!
    pub mExpansion: [u8; 48],              // reserved
}

/// rF2ScoringInfo — session-wide scoring data (does NOT contain the vehicle array;
/// vehicles are in rF2ScoringBuffer.mVehicles, following this struct in memory)
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct rF2ScoringInfo {
    pub mTrackName: [u8; 64],               // track name
    pub mSession: i32,                       // 0=testday,1-4=practice,5-8=qual,9=warmup,10-13=race
    pub mCurrentET: f64,                     // current session time (s)
    pub mEndET: f64,                         // session end time (s)
    pub mMaxLaps: i32,                       // max laps (999999 if time-based)
    pub mLapDist: f64,                       // full lap distance (m)
    pub mPointer1: [u8; 8],                 // padding for pointer (64-bit plugin)
    pub mNumVehicles: i32,                  // vehicles currently in session
    pub mGamePhase: u8,                      // 0=garage,1=warmup,2=gridwalk,3=formation,...
    pub mYellowFlagState: i8,               // 0=none,1=pending,2=pits closed,3=pit lead lap,4=pits open,5=last lap,6=resume,7=race halt
    pub mSectorFlag: [i8; 3],               // local yellow in each sector
    pub mStartLight: u8,                    // start light frame number
    pub mNumRedLights: u8,                  // red lights in start sequence
    pub mInRealtime: u8,                    // 1 if in realtime (not at monitor/menu)
    pub mPlayerName: [u8; 32],              // local player name
    pub mPlrFileName: [u8; 64],             // player file name
    pub mDarkCloud: f64,                    // cloud darkness 0.0–1.0
    pub mRaining: f64,                      // rain severity 0.0–1.0
    pub mAmbientTemp: f64,                  // air temperature (Celsius)
    pub mTrackTemp: f64,                    // track temperature (Celsius)
    pub mWind: rF2Vec3,                      // wind vector (m/s)
    pub mMinPathWetness: f64,              // minimum wetness on racing line (0–1)
    pub mMaxPathWetness: f64,              // maximum wetness on racing line (0–1)
    pub mGameMode: u8,                      // 1=single-player,2=multiplayer,3=competition
    pub mIsPasswordProtected: u8,          // 1 if server is password protected
    pub mServerPort: u16,                   // server port
    pub mServerPublicIP: u32,               // server public IP (packed u32)
    pub mMaxPlayers: i32,                  // max players in server
    pub mServerName: [u8; 32],             // server name
    pub mStartET: f32,                      // event start time (seconds since midnight)  ← f32!
    pub mAvgPathWetness: f64,              // average wetness on racing line (0–1)

    // --- LMU-native fields, carved out of the former mExpansion[200] ---
    //
    // LMU adds fields to this struct by consuming reserve bytes rather than
    // extending it: 13 bytes named here + mExpansion[187] = the original 200,
    // so the struct size is unchanged (asserted in the tests below). We were
    // already reading these bytes — they just had no names.
    //
    // Verified against LMU's official SharedMemoryInterface.hpp (shipped in
    // the game's Support\SharedMemoryInterface folder), 1.3 spec.
    pub mSessionTimeRemaining: f32,        // seconds left in session
    pub mTimeOfDay: f32,                    // seconds since midnight
    pub mIsFixedSetup: u8,                  // 1 if the session enforces a fixed setup
    pub mTrackGripLevel: u8,                // 0=green,1=low,2=medium,3=high,4=saturated
    /// Sky type, same 0–10 scale as `WeatherForecastNode::sky_type` from the
    /// REST API: 0=clear, 4=overcast, 6=cloudy & light rain, 10=overcast & storm.
    pub mCloudCoverage: u8,
    pub mTrackLimitsStepsPerPenalty: u8,   // steps that add up to one penalty
    /// Divisor for `rF2VehicleTelemetry::mTrackLimitsSteps`: steps per point.
    pub mTrackLimitsStepsPerPoint: u8,

    pub mExpansion: [u8; 187],             // reserved (was 200 before the fields above)
    pub mPointer2: [u8; 8],                // padding for pointer (64-bit plugin)
}
/// The Windows named mapping LMU publishes. No `$…$` decoration, unlike the
/// plugin's names.
pub const LMU_DATA_NAME: &str = "LMU_Data";

/// Vehicle slots in `LMU_Data`. **Not** the same as
/// [`super::types::MAX_MAPPED_VEHICLES`], which is the plugin's 128.
pub const MAX_MAPPED_VEHICLES: usize = 104;

/// Compile-time `size_of` assertion.
///
/// These are the load-bearing part of this file. Every offset below is implied
/// by the sizes of what precedes it, so if S397 adds a field to any embedded
/// struct, the build breaks here rather than the dashboard quietly showing tire
/// temperatures read from the wrong bytes — which is exactly the failure a null
/// check cannot catch.
macro_rules! assert_size {
    ($t:ty, $n:expr) => {
        const _: () = assert!(std::mem::size_of::<$t>() == $n);
    };
}

assert_size!(rF2ScoringInfo, 548);
assert_size!(rF2VehicleScoring, 584);
assert_size!(rF2VehicleTelemetry, 1888);
assert_size!(rF2Wheel, 260);

// ---------------------------------------------------------------------------
// Containers (SharedMemoryInterface.hpp: SharedMemoryObjectOut)
// ---------------------------------------------------------------------------

/// Per-event-type counters, bumped by the game as callbacks fire.
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct LmuEvent {
    pub SME_ENTER: u32,
    pub SME_EXIT: u32,
    pub SME_STARTUP: u32,
    pub SME_SHUTDOWN: u32,
    pub SME_LOAD: u32,
    pub SME_UNLOAD: u32,
    pub SME_START_SESSION: u32,
    pub SME_END_SESSION: u32,
    pub SME_ENTER_REALTIME: u32,
    pub SME_EXIT_REALTIME: u32,
    pub SME_UPDATE_SCORING: u32,
    pub SME_UPDATE_TELEMETRY: u32,
    pub SME_INIT_APPLICATION: u32,
    pub SME_UNINIT_APPLICATION: u32,
    pub SME_SET_ENVIRONMENT: u32,
    pub SME_FFB: u32,
}
assert_size!(LmuEvent, 64);

#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct LmuApplicationState {
    pub mAppWindow: u64,
    pub mWidth: u32,
    pub mHeight: u32,
    pub mRefreshRate: u32,
    pub mWindowed: u32,
    pub mOptionsLocation: u8,
    pub mOptionsPage: [u8; 31],
    pub mExpansion: [u8; 204],
}
assert_size!(LmuApplicationState, 260);

#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct LmuGeneric {
    pub events: LmuEvent,
    /// Build number, e.g. `14000` for LMU 1.4. Replaces the plugin version
    /// string the bridge used to fish out of the Extended buffer, and unlike
    /// that string it is written by the game itself.
    pub gameVersion: i32,
    pub FFBTorque: f32,
    pub appInfo: LmuApplicationState,
}
assert_size!(LmuGeneric, 332);

#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct LmuPathData {
    pub userData: [u8; 260],
    pub customVariables: [u8; 260],
    pub stewardResults: [u8; 260],
    pub playerProfile: [u8; 260],
    pub pluginsFolder: [u8; 260],
}
assert_size!(LmuPathData, 1300);

#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct LmuScoringData {
    pub scoringInfo: rF2ScoringInfo,
    pub scoringStreamSize: [u8; 12],
    pub vehScoringInfo: [rF2VehicleScoring; MAX_MAPPED_VEHICLES],
    pub scoringStream: [u8; 65536],
}
assert_size!(LmuScoringData, 126_832);

#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct LmuTelemetryData {
    pub activeVehicles: u8,
    /// Index into `telemInfo`. The plugin path had to scan for `mIsPlayer` and
    /// then match IDs across two buffers; LMU hands the slot over directly.
    pub playerVehicleIdx: u8,
    pub playerHasVehicle: u8,
    pub telemInfo: [rF2VehicleTelemetry; MAX_MAPPED_VEHICLES],
}
assert_size!(LmuTelemetryData, 196_356);

/// The complete mapping: `SharedMemoryObjectOut`.
///
/// Never read as a whole — at 324 KB a full copy would take longer than the
/// 10 ms between telemetry writes is worth risking. [`super::reader`] copies
/// the header scalars and only the occupied vehicle slots.
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
pub struct LmuObjectOut {
    pub generic: LmuGeneric,
    pub paths: LmuPathData,
    pub scoring: LmuScoringData,
    pub telemetry: LmuTelemetryData,
}
assert_size!(LmuObjectOut, 324_820);

// ---------------------------------------------------------------------------
// Byte offsets used by the reader
//
// Spelled out with `offset_of!` rather than by hand: these are what the reader
// addresses instead of copying whole containers, and a hand-counted offset is
// the one part of this file the size assertions above could not protect.
// ---------------------------------------------------------------------------



/// `generic.gameVersion`.
pub const OFF_GAME_VERSION: usize =
    offset_of!(LmuObjectOut, generic) + offset_of!(LmuGeneric, gameVersion);

/// `scoring.scoringInfo` — the session-wide record.
pub const OFF_SCORING_INFO: usize =
    offset_of!(LmuObjectOut, scoring) + offset_of!(LmuScoringData, scoringInfo);

/// `scoring.scoringInfo.mCurrentET`, the 5 Hz scoring clock. Used as the
/// witness that no scoring write landed inside our copy.
pub const OFF_SCORING_ET: usize = OFF_SCORING_INFO + offset_of!(rF2ScoringInfo, mCurrentET);

/// `scoring.scoringInfo.mNumVehicles`.
pub const OFF_SCORING_NUM_VEHICLES: usize =
    OFF_SCORING_INFO + offset_of!(rF2ScoringInfo, mNumVehicles);

/// `scoring.vehScoringInfo[0]`.
pub const OFF_VEH_SCORING: usize =
    offset_of!(LmuObjectOut, scoring) + offset_of!(LmuScoringData, vehScoringInfo);

/// `telemetry.activeVehicles`.
pub const OFF_ACTIVE_VEHICLES: usize =
    offset_of!(LmuObjectOut, telemetry) + offset_of!(LmuTelemetryData, activeVehicles);

/// `telemetry.playerVehicleIdx`.
pub const OFF_PLAYER_IDX: usize =
    offset_of!(LmuObjectOut, telemetry) + offset_of!(LmuTelemetryData, playerVehicleIdx);

/// `telemetry.playerHasVehicle`.
pub const OFF_PLAYER_HAS_VEHICLE: usize =
    offset_of!(LmuObjectOut, telemetry) + offset_of!(LmuTelemetryData, playerHasVehicle);

/// `telemetry.telemInfo[0]`.
pub const OFF_TELEM_INFO: usize =
    offset_of!(LmuObjectOut, telemetry) + offset_of!(LmuTelemetryData, telemInfo);

/// `rF2VehicleTelemetry::mElapsedTime`, the 100 Hz physics clock. The other
/// witness: telemetry ticks twenty times per scoring tick, so it is the field
/// most likely to move underneath a copy.
pub const OFF_VEH_ELAPSED: usize = offset_of!(rF2VehicleTelemetry, mElapsedTime);

#[cfg(test)]
mod tests {
    use super::*;

    /// The offsets are what the reader dereferences, so an arithmetic slip here
    /// produces exactly the plausible-looking garbage the size assertions exist
    /// to prevent. Check them against the layout independently.
    #[test]
    fn offsets_land_inside_the_mapping() {
        let size = std::mem::size_of::<LmuObjectOut>();
        for (name, off, len) in [
            ("gameVersion", OFF_GAME_VERSION, 4),
            ("scoringInfo", OFF_SCORING_INFO, std::mem::size_of::<rF2ScoringInfo>()),
            ("mCurrentET", OFF_SCORING_ET, 8),
            ("mNumVehicles", OFF_SCORING_NUM_VEHICLES, 4),
            (
                "vehScoringInfo",
                OFF_VEH_SCORING,
                std::mem::size_of::<rF2VehicleScoring>() * MAX_MAPPED_VEHICLES,
            ),
            ("activeVehicles", OFF_ACTIVE_VEHICLES, 1),
            ("playerVehicleIdx", OFF_PLAYER_IDX, 1),
            ("playerHasVehicle", OFF_PLAYER_HAS_VEHICLE, 1),
            (
                "telemInfo",
                OFF_TELEM_INFO,
                std::mem::size_of::<rF2VehicleTelemetry>() * MAX_MAPPED_VEHICLES,
            ),
        ] {
            assert!(
                off + len <= size,
                "{name} at {off}+{len} runs past the {size}-byte mapping",
            );
        }
    }

    /// The scoring block precedes the telemetry block, and the vehicle arrays
    /// sit inside their own containers. Ordering mistakes would still satisfy
    /// the bounds check above.
    #[test]
    fn blocks_are_in_the_documented_order() {
        assert!(OFF_GAME_VERSION < OFF_SCORING_INFO);
        assert!(OFF_SCORING_INFO < OFF_VEH_SCORING);
        assert!(OFF_VEH_SCORING < OFF_ACTIVE_VEHICLES);
        assert!(OFF_ACTIVE_VEHICLES < OFF_TELEM_INFO);
        assert_eq!(OFF_PLAYER_IDX, OFF_ACTIVE_VEHICLES + 1);
        assert_eq!(OFF_PLAYER_HAS_VEHICLE, OFF_ACTIVE_VEHICLES + 2);
    }

    /// LMU maps 104 slots. The plugin mapped 128, and its constant used to live
    /// in `types.rs` next to these structs — reading a vehicle array with the
    /// wrong one walks off the end of the mapping. The plugin's constant is
    /// gone with the plugin; this pins the survivor so a future edit cannot
    /// quietly reintroduce the mismatch.
    #[test]
    fn slot_count_is_lmus_own() {
        assert_eq!(MAX_MAPPED_VEHICLES, 104);
        assert_eq!(
            OFF_TELEM_INFO + std::mem::size_of::<rF2VehicleTelemetry>() * MAX_MAPPED_VEHICLES,
            std::mem::size_of::<LmuObjectOut>(),
            "telemInfo is the last block, so its end must be the end of the mapping",
        );
    }
}

