/**
 * Cached ethers.Interface instances for every contract surface the DAO writes to.
 *
 * These are authored inline (not read from compiled artifacts) so the DAO scripts
 * can run without a full Hardhat compile step and so the list of governed functions
 * is auditable in one place. Event signatures mirror ILendingPoolConfigurator.sol.
 */
import { utils } from 'ethers';

export const ILendingPoolConfigurator = new utils.Interface([
  // Risk params
  'function setLtv(address asset, uint256 ltv)',
  'function setLiquidationThreshold(address asset, uint256 threshold)',
  'function setLiquidationBonus(address asset, uint256 bonus)',
  'function setReserveFactor(address asset, uint256 reserveFactor)',
  'function configureReserveAsCollateral(address asset, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus)',
  'function setReserveInterestRateStrategyAddress(address asset, address rateStrategyAddress)',
  // Lifecycle
  'function activateReserve(address asset)',
  'function deactivateReserve(address asset)',
  'function freezeReserve(address asset)',
  'function unfreezeReserve(address asset)',
  'function enableBorrowingOnReserve(address asset, bool stableBorrowRateEnabled)',
  'function disableBorrowingOnReserve(address asset)',
  'function enableReserveStableRate(address asset)',
  'function disableReserveStableRate(address asset)',
  // Caps
  'function setSupplyCap(address asset, uint256 supplyCap)',
  'function setBorrowCap(address asset, uint256 borrowCap)',
  // Listing / upgrades
  'function batchInitReserve((address aTokenImpl,address stableDebtTokenImpl,address variableDebtTokenImpl,uint8 underlyingAssetDecimals,address interestRateStrategyAddress,address underlyingAsset,address treasury,address incentivesController,string underlyingAssetName,string aTokenName,string aTokenSymbol,string variableDebtTokenName,string variableDebtTokenSymbol,string stableDebtTokenName,string stableDebtTokenSymbol,bytes params)[] input)',
  'function updateAToken((address asset,address treasury,address incentivesController,string name,string symbol,address implementation,bytes params) input)',
  'function updateVariableDebtToken((address asset,address incentivesController,string name,string symbol,address implementation,bytes params) input)',
  'function updateStableDebtToken((address asset,address incentivesController,string name,string symbol,address implementation,bytes params) input)',
  // Pause (guardian path)
  'function setPoolPause(bool val)',
  // Events (subset — used by verify/simulate to assert expected emissions)
  'event CollateralConfigurationChanged(address indexed asset, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus)',
  'event ReserveFactorChanged(address indexed asset, uint256 factor)',
  'event ReserveInterestRateStrategyChanged(address indexed asset, address strategy)',
  'event BorrowingEnabledOnReserve(address indexed asset, bool stableRateEnabled)',
  'event BorrowingDisabledOnReserve(address indexed asset)',
  'event StableRateEnabledOnReserve(address indexed asset)',
  'event StableRateDisabledOnReserve(address indexed asset)',
  'event ReserveActivated(address indexed asset)',
  'event ReserveDeactivated(address indexed asset)',
  'event ReserveFrozen(address indexed asset)',
  'event ReserveUnfrozen(address indexed asset)',
  'event BorrowCapChanged(address indexed asset, uint256 oldBorrowCap, uint256 newBorrowCap)',
  'event SupplyCapChanged(address indexed asset, uint256 oldSupplyCap, uint256 newSupplyCap)',
  'event ReserveInitialized(address indexed asset, address indexed aToken, address stableDebtToken, address variableDebtToken, address interestRateStrategyAddress)',
  'event ATokenUpgraded(address indexed asset, address indexed proxy, address indexed implementation)',
  'event StableDebtTokenUpgraded(address indexed asset, address indexed proxy, address indexed implementation)',
  'event VariableDebtTokenUpgraded(address indexed asset, address indexed proxy, address indexed implementation)',
]);

export const ILendingPoolAddressesProvider = new utils.Interface([
  // Admin + impl
  'function setPoolAdmin(address admin)',
  'function setEmergencyAdmin(address admin)',
  'function setLendingPoolImpl(address pool)',
  'function setLendingPoolConfiguratorImpl(address configurator)',
  'function setLendingPoolCollateralManager(address manager)',
  'function setPriceOracle(address priceOracle)',
  'function setLendingRateOracle(address lendingRateOracle)',
  'function setAddress(bytes32 id, address newAddress)',
  'function setAddressAsProxy(bytes32 id, address impl)',
  'function transferOwnership(address newOwner)',
  // Reads
  'function getPoolAdmin() view returns (address)',
  'function getEmergencyAdmin() view returns (address)',
  'function owner() view returns (address)',
  'function getAddress(bytes32 id) view returns (address)',
  'function getPriceOracle() view returns (address)',
  'function getLendingRateOracle() view returns (address)',
]);

export const IAaveOracle = new utils.Interface([
  'function setAssetSources(address[] assets, address[] sources)',
  'function setFallbackOracle(address fallbackOracle)',
  'function getAssetPrice(address asset) view returns (uint256)',
  'function getSourceOfAsset(address asset) view returns (address)',
  'function getFallbackOracle() view returns (address)',
]);

export const ILendingRateOracle = new utils.Interface([
  'function setMarketBorrowRate(address asset, uint256 rate)',
  'function getMarketBorrowRate(address asset) view returns (uint256)',
]);

export const IAaveProtocolDataProvider = new utils.Interface([
  'function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)',
  'function getReserveCaps(address asset) view returns (uint256 borrowCap, uint256 supplyCap)',
  'function getReserveData(address asset) view returns (uint256 availableLiquidity, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)',
  'function getReserveTokensAddresses(address asset) view returns (address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress)',
]);

export const ILendingPool = new utils.Interface([
  'function paused() view returns (bool)',
]);

export const IAToken = new utils.Interface([
  'function sweepToTreasury(address[] tokens)',
  'function implementation() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
]);

// Gnosis Safe v1.4.1 minimal surface the DAO scripts touch.
export const IGnosisSafe = new utils.Interface([
  'function getOwners() view returns (address[])',
  'function getThreshold() view returns (uint256)',
  'function isOwner(address owner) view returns (bool)',
  'function nonce() view returns (uint256)',
  'function approvedHashes(address owner, bytes32 hash) view returns (uint256)',
  'function approveHash(bytes32 hashToApprove)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
]);

export const IMultiSendCallOnly = new utils.Interface([
  'function multiSend(bytes transactions)',
]);

// Staking module — signatures are stubs pending §0.2 discovery. Kept here so
// stub action modules compile; operator must confirm before wiring up.
export const IStakingModule = new utils.Interface([
  'function setRewardRate(uint256 rate)',
  'function setRewardsDuration(uint256 duration)',
  'function recoverERC20(address token, uint256 amount)',
]);

export const Interfaces = {
  ILendingPoolConfigurator,
  ILendingPoolAddressesProvider,
  IAaveOracle,
  ILendingRateOracle,
  IAaveProtocolDataProvider,
  ILendingPool,
  IAToken,
  IGnosisSafe,
  IMultiSendCallOnly,
  IStakingModule,
};
