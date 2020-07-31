import React, { createContext, useContext, useReducer, useMemo, useCallback, useEffect } from 'react'

import { client } from '../apollo/client'
import {
  TOKEN_DATA,
  FILTERED_TRANSACTIONS,
  TOKEN_CHART,
  TOKENS_CURRENT,
  TOKENS_DYNAMIC,
  HOURLY_PRICES
} from '../apollo/queries'

import { useEthPrice } from './GlobalData'

import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

import {
  get2DayPercentChange,
  getPercentChange,
  getBlockFromTimestamp,
  isAddress,
  getBlocksFromTimestamps
} from '../utils'
import { timeframeOptions } from '../constants'

const UPDATE = 'UPDATE'
const UPDATE_TOKEN_TXNS = 'UPDATE_TOKEN_TXNS'
const UPDATE_CHART_DATA = 'UPDATE_CHART_DATA'
const UPDATE_HOURLY_DATA = 'UPDATE_HOURLY_DATA'
const UPDATE_DAILY_PRICE_DATA = 'UPDATE_DAILY_PRICE_DATA'
const UPDATE_TOP_TOKENS = ' UPDATE_TOP_TOKENS'
const UPDATE_ALL_PAIRS = 'UPDATE_ALL_PAIRS'

const TOKEN_PAIRS_KEY = 'TOKEN_PAIRS_KEY'

dayjs.extend(utc)

const TokenDataContext = createContext()

function useTokenDataContext() {
  return useContext(TokenDataContext)
}

function reducer(state, { type, payload }) {
  switch (type) {
    case UPDATE: {
      const { tokenAddress, data } = payload
      return {
        ...state,
        [tokenAddress]: {
          ...state?.[tokenAddress],
          ...data
        }
      }
    }
    case UPDATE_TOP_TOKENS: {
      const { topTokens } = payload
      let added = {}
      topTokens &&
        topTokens.map(token => {
          return (added[token.id] = token)
        })
      return {
        ...state,
        ...added
      }
    }

    case UPDATE_TOKEN_TXNS: {
      const { address, transactions } = payload
      return {
        ...state,
        [address]: {
          ...state?.[address],
          txns: transactions
        }
      }
    }
    case UPDATE_CHART_DATA: {
      const { address, chartData } = payload
      return {
        ...state,
        [address]: {
          ...state?.[address],
          chartData
        }
      }
    }

    case UPDATE_HOURLY_DATA: {
      const { address, hourlyData, timeWindow } = payload
      return {
        ...state,
        [address]: {
          ...state?.[address],
          hourlyData: {
            ...state?.[address].hourlyData,
            [timeWindow]: hourlyData
          }
        }
      }
    }

    case UPDATE_DAILY_PRICE_DATA: {
      const { address, data, timeWindow } = payload
      return {
        ...state,
        [address]: {
          ...state?.[address],
          dailyPriceData: {
            ...state?.[address].dailyPriceData,
            [timeWindow]: data
          }
        }
      }
    }

    case UPDATE_ALL_PAIRS: {
      const { address, allPairs } = payload
      return {
        ...state,
        [address]: {
          ...state?.[address],
          [TOKEN_PAIRS_KEY]: allPairs
        }
      }
    }
    default: {
      throw Error(`Unexpected action type in DataContext reducer: '${type}'.`)
    }
  }
}

export default function Provider({ children }) {
  const [state, dispatch] = useReducer(reducer, {})
  const update = useCallback((tokenAddress, data) => {
    dispatch({
      type: UPDATE,
      payload: {
        tokenAddress,
        data
      }
    })
  }, [])

  const updateTopTokens = useCallback(topTokens => {
    dispatch({
      type: UPDATE_TOP_TOKENS,
      payload: {
        topTokens
      }
    })
  }, [])

  const updateTokenTxns = useCallback((address, transactions) => {
    dispatch({
      type: UPDATE_TOKEN_TXNS,
      payload: { address, transactions }
    })
  }, [])

  const updateChartData = useCallback((address, chartData) => {
    dispatch({
      type: UPDATE_CHART_DATA,
      payload: { address, chartData }
    })
  }, [])

  const updateAllPairs = useCallback((address, allPairs) => {
    dispatch({
      type: UPDATE_ALL_PAIRS,
      payload: { address, allPairs }
    })
  }, [])

  const updateHourlyData = useCallback((address, hourlyData, timeWindow) => {
    dispatch({
      type: UPDATE_HOURLY_DATA,
      payload: { address, hourlyData, timeWindow }
    })
  }, [])

  const updateDailyPriceData = useCallback((address, data, timeWindow) => {
    dispatch({
      type: UPDATE_DAILY_PRICE_DATA,
      payload: { address, data, timeWindow }
    })
  }, [])

  return (
    <TokenDataContext.Provider
      value={useMemo(
        () => [
          state,
          {
            update,
            updateTokenTxns,
            updateChartData,
            updateTopTokens,
            updateAllPairs,
            updateHourlyData,
            updateDailyPriceData
          }
        ],
        [
          state,
          update,
          updateTokenTxns,
          updateChartData,
          updateTopTokens,
          updateAllPairs,
          updateHourlyData,
          updateDailyPriceData
        ]
      )}
    >
      {children}
    </TokenDataContext.Provider>
  )
}

const getTopTokens = async (ethPrice, ethPriceOld) => {
  const utcCurrentTime = dayjs()
  const utcOneDayBack = utcCurrentTime.subtract(1, 'day').unix()
  const utcTwoDaysBack = utcCurrentTime.subtract(2, 'day').unix()
  let oneDayBlock = await getBlockFromTimestamp(utcOneDayBack)
  let twoDayBlock = await getBlockFromTimestamp(utcTwoDaysBack)

  try {
    let current = await client.query({
      query: TOKENS_CURRENT,
      fetchPolicy: 'cache-first'
    })

    let oneDayResult = await client.query({
      query: TOKENS_DYNAMIC(oneDayBlock),
      fetchPolicy: 'cache-first'
    })

    let twoDayResult = await client.query({
      query: TOKENS_DYNAMIC(twoDayBlock),
      fetchPolicy: 'cache-first'
    })

    let oneDayData = oneDayResult?.data?.tokens.reduce((obj, cur, i) => {
      return { ...obj, [cur.id]: cur }
    }, {})

    let twoDayData = twoDayResult?.data?.tokens.reduce((obj, cur, i) => {
      return { ...obj, [cur.id]: cur }
    }, {})

    return (
      current &&
      oneDayData &&
      twoDayData &&
      current?.data?.tokens.map(token => {
        let data = token

        let oneDayHistory = oneDayData?.[token.id]
        let twoDayHistory = twoDayData?.[token.id]

        // calculate percentage changes and daily changes
        const [oneDayVolumeUSD, volumeChangeUSD] = get2DayPercentChange(
          data.tradeVolumeUSD,
          oneDayHistory?.tradeVolumeUSD ?? 0,
          twoDayHistory?.tradeVolumeUSD ?? 0
        )
        const [oneDayTxns, txnChange] = get2DayPercentChange(
          data.txCount,
          oneDayHistory?.txCount ?? 0,
          twoDayHistory?.txCount ?? 0
        )

        const currentLiquidityUSD = data?.totalLiquidity * ethPrice * data?.derivedETH
        const oldLiquidityUSD = oneDayHistory?.totalLiquidity * ethPriceOld * oneDayHistory?.derivedETH

        // percent changes
        const priceChangeUSD = getPercentChange(
          data?.derivedETH * ethPrice,
          oneDayHistory?.derivedETH ? oneDayHistory?.derivedETH * ethPriceOld : 0
        )

        // set data
        data.priceUSD = data?.derivedETH * ethPrice
        data.totalLiquidityUSD = currentLiquidityUSD
        data.oneDayVolumeUSD = oneDayVolumeUSD
        data.volumeChangeUSD = volumeChangeUSD
        data.priceChangeUSD = priceChangeUSD
        data.liquidityChangeUSD = getPercentChange(currentLiquidityUSD ?? 0, oldLiquidityUSD ?? 0)
        data.oneDayTxns = oneDayTxns
        data.txnChange = txnChange

        // new tokens
        if (!oneDayHistory && data) {
          data.oneDayVolumeUSD = data.tradeVolumeUSD
          data.oneDayVolumeETH = data.tradeVolume * data.derivedETH
          data.oneDayTxns = data.txCount
        }

        if (data.id === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2') {
          data.name = 'Ether (Wrapped)'
          data.symbol = 'ETH'
        }
        return data
      })
    )

    // calculate percentage changes and daily changes
  } catch (e) {
    console.log(e)
  }
}

const getTokenData = async (address, ethPrice, ethPriceOld) => {
  const utcCurrentTime = dayjs()
  const utcOneDayBack = utcCurrentTime
    .subtract(1, 'day')
    .startOf('minute')
    .unix()
  const utcTwoDaysBack = utcCurrentTime
    .subtract(2, 'day')
    .startOf('minute')
    .unix()
  let oneDayBlock = await getBlockFromTimestamp(utcOneDayBack)
  let twoDayBlock = await getBlockFromTimestamp(utcTwoDaysBack)

  // initialize data arrays
  let data = {}
  let oneDayData = {}
  let twoDayData = {}

  try {
    // fetch all current and historical data
    let result = await client.query({
      query: TOKEN_DATA(address),
      fetchPolicy: 'cache-first'
    })
    data = result?.data?.tokens?.[0]

    // get results from 24 hours in past
    let oneDayResult = await client.query({
      query: TOKEN_DATA(address, oneDayBlock),
      fetchPolicy: 'cache-first'
    })
    oneDayData = oneDayResult.data.tokens[0]

    // get results from 48 hours in past
    let twoDayResult = await client.query({
      query: TOKEN_DATA(address, twoDayBlock),
      fetchPolicy: 'cache-first'
    })
    twoDayData = twoDayResult.data.tokens[0]

    // calculate percentage changes and daily changes
    const [oneDayVolumeUSD, volumeChangeUSD] = get2DayPercentChange(
      data.tradeVolumeUSD,
      oneDayData?.tradeVolumeUSD,
      twoDayData?.tradeVolumeUSD
    )

    // calculate percentage changes and daily changes
    const [oneDayTxns, txnChange] = get2DayPercentChange(data.txCount, oneDayData?.txCount, twoDayData?.txCount)

    const priceChangeUSD = getPercentChange(data?.derivedETH * ethPrice, oneDayData?.derivedETH * ethPriceOld)
    const liquidityChangeUSD = getPercentChange(data?.totalLiquidityUSD, oneDayData?.totalLiquidityUSD)

    // set data
    data.priceUSD = data?.derivedETH * ethPrice
    data.totalLiquidityUSD = data?.totalLiquidity * ethPrice * data?.derivedETH
    data.oneDayVolumeUSD = oneDayVolumeUSD
    data.volumeChangeUSD = volumeChangeUSD
    data.priceChangeUSD = priceChangeUSD
    data.liquidityChangeUSD = liquidityChangeUSD
    data.oneDayTxns = oneDayTxns
    data.txnChange = txnChange

    // new tokens
    if (!oneDayData && data) {
      data.oneDayVolumeUSD = data.tradeVolumeUSD
      data.oneDayVolumeETH = data.tradeVolume * data.derivedETH
      data.oneDayTxns = data.txCount
    }

    if (data.id === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2') {
      data.name = 'ETH (Wrapped)'
      data.symbol = 'ETH'
    }
  } catch (e) {
    console.log(e)
  }
  return data
}

const getTokenTransactions = async (tokenAddress, allPairsFormatted) => {
  const transactions = {}
  try {
    let result = await client.query({
      query: FILTERED_TRANSACTIONS,
      variables: {
        allPairs: allPairsFormatted
      },
      fetchPolicy: 'cache-first'
    })
    transactions.mints = result.data.mints
    transactions.burns = result.data.burns
    transactions.swaps = result.data.swaps
  } catch (e) {
    console.log(e)
  }
  return transactions
}

const getTokenPairs = async tokenAddress => {
  try {
    // fetch all current and historical data
    let result = await client.query({
      query: TOKEN_DATA(tokenAddress),
      fetchPolicy: 'cache-first'
    })
    return result.data?.['pairs0'].concat(result.data?.['pairs1'])
  } catch (e) {
    console.log(e)
  }
}

const getHourlyTokenData = async (tokenAddress, startTime, interval = 3600) => {
  const utcEndTime = dayjs.utc()
  let time = startTime

  // create an array of hour start times until we reach current hour
  const timestamps = []
  while (time < utcEndTime.unix()) {
    timestamps.push(time)
    time += interval
  }

  // backout if invalid timestamp format
  if (timestamps.length === 0) {
    return []
  }

  // once you have all the timestamps, get the blocks for each timestamp in a bulk query
  let blocks
  try {
    blocks = await getBlocksFromTimestamps(timestamps)
  } catch (e) {
    console.log('error fetchign blocks')
  }
  // catch failing case
  if (blocks.length === 0) {
    return []
  }

  // pass the blocks to a token query
  let result = await client.query({
    query: HOURLY_PRICES(tokenAddress, blocks),
    fetchPolicy: 'cache-first'
  })

  // format token ETH price results
  let values = []
  for (var row in result?.data) {
    let timestamp = row.split('t')[1]
    let derivedETH = parseFloat(result.data[row]?.derivedETH)
    if (timestamp) {
      values.push({
        timestamp,
        derivedETH
      })
    }
  }

  // go through eth usd prices and assign to original values array
  let index = 0
  for (var brow in result?.data) {
    let timestamp = brow.split('b')[1]
    if (timestamp) {
      values[index].priceUSD = result.data[brow].ethPrice * values[index].derivedETH
      index += 1
    }
  }

  let formattedHistory = []

  // for each hour, construct the open and close price
  for (let i = 0; i < values.length - 1; i++) {
    formattedHistory.push({
      timestamp: values[i].timestamp,
      open: parseFloat(values[i].priceUSD),
      close: parseFloat(values[i + 1].priceUSD)
    })
  }

  return formattedHistory
}

const getTokenChartData = async tokenAddress => {
  let data = []
  const utcEndTime = dayjs.utc()
  let utcStartTime = utcEndTime.subtract(1, 'year')
  let startTime = utcStartTime.startOf('minute').unix() - 1

  try {
    let result = await client.query({
      query: TOKEN_CHART,
      variables: {
        tokenAddr: tokenAddress
      },
      fetchPolicy: 'cache-first'
    })
    data = data.concat(result.data.tokenDayDatas)
    let dayIndexSet = new Set()
    let dayIndexArray = []
    const oneDay = 24 * 60 * 60
    data.forEach((dayData, i) => {
      // add the day index to the set of days
      dayIndexSet.add((data[i].date / oneDay).toFixed(0))
      dayIndexArray.push(data[i])
      dayData.dailyVolumeUSD = parseFloat(dayData.dailyVolumeUSD)
    })

    // fill in empty days
    let timestamp = data[0] && data[0].date ? data[0].date : startTime
    let latestLiquidityUSD = data[0] && data[0].totalLiquidityUSD
    let latestPriceUSD = data[0] && data[0].priceUSD
    let latestPairDatas = data[0] && data[0].mostLiquidPairs
    let index = 1
    while (timestamp < utcEndTime.startOf('minute').unix() - oneDay) {
      const nextDay = timestamp + oneDay
      let currentDayIndex = (nextDay / oneDay).toFixed(0)
      if (!dayIndexSet.has(currentDayIndex)) {
        data.push({
          date: nextDay,
          dayString: nextDay,
          dailyVolumeUSD: 0,
          priceUSD: latestPriceUSD,
          totalLiquidityUSD: latestLiquidityUSD,
          mostLiquidPairs: latestPairDatas
        })
      } else {
        latestLiquidityUSD = dayIndexArray[index].totalLiquidityUSD
        latestPriceUSD = dayIndexArray[index].priceUSD
        latestPairDatas = dayIndexArray[index].mostLiquidPairs
        index = index + 1
      }
      timestamp = nextDay
    }
    data = data.sort((a, b) => (parseInt(a.date) > parseInt(b.date) ? 1 : -1))
  } catch (e) {
    console.log(e)
  }
  return data
}

export function Updater() {
  const [, { updateTopTokens }] = useTokenDataContext()
  const [ethPrice, ethPriceOld] = useEthPrice()
  useEffect(() => {
    async function getData() {
      // get top pairs for overview list
      let topTokens = await getTopTokens(ethPrice, ethPriceOld)
      topTokens && updateTopTokens(topTokens)
    }
    ethPrice && ethPriceOld && getData()
  }, [ethPrice, ethPriceOld, updateTopTokens])
  return null
}

export function useTokenData(tokenAddress) {
  const [state, { update }] = useTokenDataContext()
  const [ethPrice, ethPriceOld] = useEthPrice()
  const tokenData = state?.[tokenAddress]

  useEffect(() => {
    if (!tokenData && ethPrice && ethPriceOld && isAddress(tokenAddress)) {
      getTokenData(tokenAddress, ethPrice, ethPriceOld).then(data => {
        update(tokenAddress, data)
      })
    }
  }, [ethPrice, ethPriceOld, tokenAddress, tokenData, update])

  return tokenData || {}
}

export function useTokenTransactions(tokenAddress) {
  const [state, { updateTokenTxns }] = useTokenDataContext()
  const tokenTxns = state?.[tokenAddress]?.txns

  const allPairsFormatted =
    state[tokenAddress] &&
    state[tokenAddress].TOKEN_PAIRS_KEY &&
    state[tokenAddress].TOKEN_PAIRS_KEY.map(pair => {
      return pair.id
    })

  useEffect(() => {
    async function checkForTxns() {
      if (!tokenTxns && allPairsFormatted) {
        let transactions = await getTokenTransactions(tokenAddress, allPairsFormatted)
        updateTokenTxns(tokenAddress, transactions)
      }
    }
    checkForTxns()
  }, [tokenTxns, tokenAddress, updateTokenTxns, allPairsFormatted])

  return tokenTxns || []
}

export function useTokenPairs(tokenAddress) {
  const [state, { updateAllPairs }] = useTokenDataContext()
  const tokenPairs = state?.[tokenAddress]?.[TOKEN_PAIRS_KEY]

  useEffect(() => {
    async function fetchData() {
      let allPairs = await getTokenPairs(tokenAddress)
      updateAllPairs(tokenAddress, allPairs)
    }
    if (!tokenPairs && isAddress(tokenAddress)) {
      fetchData()
    }
  }, [tokenAddress, tokenPairs, updateAllPairs])

  return tokenPairs || []
}

export function useTokenChartData(tokenAddress) {
  const [state, { updateChartData }] = useTokenDataContext()
  const chartData = state?.[tokenAddress]?.chartData
  useEffect(() => {
    async function checkForChartData() {
      if (!chartData) {
        let data = await getTokenChartData(tokenAddress)
        updateChartData(tokenAddress, data)
      }
    }
    checkForChartData()
  }, [chartData, tokenAddress, updateChartData])
  return chartData
}

export function useTokenHourlyData(tokenAddress, timeWindow) {
  const [state, { updateHourlyData }] = useTokenDataContext()
  const chartData = state?.[tokenAddress]?.hourlyData?.[timeWindow]

  useEffect(() => {
    const currentTime = dayjs.utc()
    const windowSize = timeWindow === timeframeOptions.MONTH ? 'month' : 'week'
    const startTime = timeWindow === timeframeOptions.ALL_TIME ? 1589760000 : currentTime.subtract(1, windowSize).unix()

    async function fetch() {
      let data = await getHourlyTokenData(tokenAddress, startTime)
      updateHourlyData(tokenAddress, data, timeWindow)
    }
    if (!chartData) {
      fetch()
    }
  }, [chartData, timeWindow, tokenAddress, updateHourlyData])

  return chartData
}

export function useTokenDailyData(tokenAddress, timeWindow) {
  const [state, { updateDailyPriceData }] = useTokenDataContext()
  const chartData = state?.[tokenAddress]?.dailyPriceData?.[timeWindow]

  useEffect(() => {
    const currentTime = dayjs.utc()
    const windowSize = timeWindow === timeframeOptions.MONTH ? 'month' : 'week'
    const startTime = timeWindow === timeframeOptions.ALL_TIME ? 1589760000 : currentTime.subtract(1, windowSize).unix()

    async function fetch() {
      let data = await getHourlyTokenData(tokenAddress, startTime, 86400)
      updateDailyPriceData(tokenAddress, data, timeWindow)
    }
    if (!chartData) {
      fetch()
    }
  }, [chartData, timeWindow, tokenAddress, updateDailyPriceData])

  return chartData
}

export function useAllTokenData() {
  const [state] = useTokenDataContext()
  return state
}
