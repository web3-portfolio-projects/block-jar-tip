import { useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { type Abi, type Hex, formatEther, parseAbiItem, parseEther } from 'viem'
import blockJarTipArtifact from './contracts/BlockJarTip.json'
import {
  useAccount,
  useChainId,
  useConnect,
  useConnectors,
  useDisconnect,
  usePublicClient,
  useWalletClient,
  useWriteContract,
} from 'wagmi'

const tipAbi = blockJarTipArtifact.abi as Abi
const tipBytecode = blockJarTipArtifact.bytecode as Hex
const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3001'
const metaMaskDeepLinkBase =
  import.meta.env.VITE_METAMASK_DEEP_LINK_BASE ?? 'https://metamask.app.link/dapp/'

type DashboardTab = 'home' | 'history' | 'profile' | 'funds'

type TipHistoryItem = {
  txHash: `0x${string}`
  sender: `0x${string}`
  amountWei: bigint
  amountEth: number
  amountUsd: number | null
  message: string
}

type DeploymentRecord = {
  contractAddress: `0x${string}` | null
  pendingTxHash: `0x${string}` | null
}

type FeedbackModalState = {
  isOpen: boolean
  variant: 'success' | 'error'
  title: string
  message: string
}

type LoadingModalState = {
  isOpen: boolean
  title: string
  message: string
}

const normalizeAddress = (value: string | null | undefined): `0x${string}` | null => {
  if (!value) return null
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as `0x${string}`) : null
}

const getDeploymentRecord = async (
  chainId: number,
  owner: `0x${string}`,
): Promise<DeploymentRecord> => {
  const query = new URLSearchParams({
    chainId: String(chainId),
    walletAddress: owner,
  })

  const response = await fetch(`${apiBaseUrl}/api/deployments?${query.toString()}`)
  if (!response.ok) {
    throw new Error('Could not load deployment record.')
  }

  const data = (await response.json()) as {
    contractAddress: string | null
    pendingTxHash: string | null
  }

  return {
    contractAddress: normalizeAddress(data.contractAddress),
    pendingTxHash: normalizeAddress(data.pendingTxHash),
  }
}

const saveDeployment = (
  chainId: number,
  owner: `0x${string}`,
  contractAddress: `0x${string}`,
): Promise<void> =>
  fetch(`${apiBaseUrl}/api/deployments`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId,
      walletAddress: owner,
      contractAddress,
    }),
  }).then((response) => {
    if (!response.ok) {
      throw new Error('Could not save deployment.')
    }
  })

const savePendingDeployment = (
  chainId: number,
  owner: `0x${string}`,
  txHash: `0x${string}`,
): Promise<void> =>
  fetch(`${apiBaseUrl}/api/pending-deployments`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId,
      walletAddress: owner,
      pendingTxHash: txHash,
    }),
  }).then((response) => {
    if (!response.ok) {
      throw new Error('Could not save pending deployment.')
    }
  })

const clearPendingDeployment = (chainId: number, owner: `0x${string}`): Promise<void> => {
  const query = new URLSearchParams({
    chainId: String(chainId),
    walletAddress: owner,
  })
  return fetch(`${apiBaseUrl}/api/pending-deployments?${query.toString()}`, {
    method: 'DELETE',
  }).then((response) => {
    if (!response.ok) {
      throw new Error('Could not clear pending deployment.')
    }
  })
}

function App() {
  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const { connectAsync, isPending: isConnecting, error: connectError } = useConnect()
  const connectors = useConnectors()
  const { disconnect } = useDisconnect()
  const { data: walletClient } = useWalletClient()
  const publicClient = usePublicClient()
  const pendingWatchRef = useRef<`0x${string}` | null>(null)

  const injectedConnector = useMemo(
    () =>
      connectors.find(
        (connector) =>
          connector.id.toLowerCase().includes('injected') ||
          connector.name.toLowerCase().includes('injected'),
      ) ?? null,
    [connectors],
  )

  const metaMaskConnector = useMemo(
    () =>
      connectors.find(
        (connector) =>
          connector.id.toLowerCase().includes('metamask') ||
          connector.name.toLowerCase().includes('metamask'),
      ) ?? null,
    [connectors],
  )

  const isMobileBrowser = useMemo(
    () => /android|iphone|ipad|ipod/i.test(navigator.userAgent),
    [],
  )

  const [merchantContract, setMerchantContract] = useState<`0x${string}` | null>(
    null,
  )
  const [pendingDeployHash, setPendingDeployHash] = useState<`0x${string}` | null>(
    null,
  )
  const [isDeploying, setIsDeploying] = useState(false)
  const [usdValue, setUsdValue] = useState('')
  const [tipMessage, setTipMessage] = useState('')
  const [ethUsdPrice, setEthUsdPrice] = useState<number | null>(null)
  const [showThankYou, setShowThankYou] = useState(false)
  const [tipSuccessHash, setTipSuccessHash] = useState<`0x${string}` | null>(null)
  const [merchantOwner, setMerchantOwner] = useState<`0x${string}` | null>(null)
  const [merchantBalance, setMerchantBalance] = useState<bigint | null>(null)
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const [activeDashboardTab, setActiveDashboardTab] = useState<DashboardTab>('home')
  const [historySort, setHistorySort] = useState<'desc' | 'asc'>('desc')
  const [tipsHistory, setTipsHistory] = useState<TipHistoryItem[]>([])
  const [historyStatus, setHistoryStatus] = useState('')
  const [feedbackModal, setFeedbackModal] = useState<FeedbackModalState>({
    isOpen: false,
    variant: 'success',
    title: '',
    message: '',
  })
  const [loadingModal, setLoadingModal] = useState<LoadingModalState>({
    isOpen: false,
    title: '',
    message: '',
  })

  const { writeContractAsync, isPending: isSigning } = useWriteContract()

  const showFeedbackModal = (
    variant: 'success' | 'error',
    title: string,
    message: string,
  ) => {
    setFeedbackModal({ isOpen: true, variant, title, message })
  }

  const closeFeedbackModal = () => {
    setFeedbackModal((prev) => ({ ...prev, isOpen: false }))
  }

  const showLoadingModal = (title: string, message: string) => {
    setLoadingModal({ isOpen: true, title, message })
  }

  const closeLoadingModal = () => {
    setLoadingModal((prev) => ({ ...prev, isOpen: false }))
  }

  const query = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const merchant = params.get('merchant')
    const contract = params.get('contract')

    const merchantAddress =
      merchant && /^0x[a-fA-F0-9]{40}$/.test(merchant)
        ? (merchant as `0x${string}`)
        : null
    const merchantContractAddress =
      contract && /^0x[a-fA-F0-9]{40}$/.test(contract)
        ? (contract as `0x${string}`)
        : null

    return {
      merchantAddress,
      merchantContractAddress,
    }
  }, [])

    useEffect(() => {
      if (!isConnected) {
        setTipsHistory([])
        setHistoryStatus('Connect MetaMask to view tips history.')
        return
      }

      if (activeDashboardTab !== 'history') return

      void loadTipsHistory()
    }, [
      activeDashboardTab,
      isConnected,
      merchantContract,
      publicClient,
      ethUsdPrice,
    ])

  const receiver = query.merchantAddress
  const targetContract = query.merchantContractAddress

  const appBase = `${window.location.origin}${window.location.pathname}`
  const userShareLink =
    address && merchantContract
      ? `${appBase}?merchant=${address}&contract=${merchantContract}`
      : ''
  const isTipPage = Boolean(targetContract)

  const refreshDeploymentState = async (
    walletAddress: `0x${string}`,
    currentChainId: number,
  ) => {
    const record = await getDeploymentRecord(currentChainId, walletAddress)
    setMerchantContract(record.contractAddress)
    setPendingDeployHash(record.pendingTxHash)
  }

  useEffect(() => {
    if (!address || !isConnected) {
      setMerchantContract(null)
      setPendingDeployHash(null)
      return
    }

    void refreshDeploymentState(address, chainId).catch(() => {
      showFeedbackModal(
        'error',
        'Database Error',
        'Could not load deployment state from SQLite API.',
      )
    })
  }, [address, isConnected, chainId])

  useEffect(() => {
    if (!connectError?.message) return
    showFeedbackModal('error', 'Wallet Connection Error', connectError.message)
  }, [connectError])

  useEffect(() => {
    if (!address || !pendingDeployHash || !publicClient) return
    if (pendingWatchRef.current === pendingDeployHash) return

    pendingWatchRef.current = pendingDeployHash
    let active = true

    const resolvePendingDeployment = async () => {
      try {
        showLoadingModal(
          'Deployment Pending',
          'Waiting for on-chain confirmation of your merchant contract...',
        )
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: pendingDeployHash,
        })

        if (!active) return

        if (receipt.status === 'success' && receipt.contractAddress) {
          const deployedAddress = receipt.contractAddress as `0x${string}`
          await saveDeployment(chainId, address, deployedAddress)
          await clearPendingDeployment(chainId, address)
          setMerchantContract(deployedAddress)
          setPendingDeployHash(null)
          showFeedbackModal(
            'success',
            'Contract Deployed',
            `Your contract is live at ${deployedAddress}.`,
          )
        } else {
          await clearPendingDeployment(chainId, address)
          setPendingDeployHash(null)
          showFeedbackModal(
            'error',
            'Deployment Failed',
            'The deployment transaction failed on-chain.',
          )
        }
      } catch {
        if (active) {
          showFeedbackModal(
            'error',
            'Confirmation Error',
            'Could not confirm pending deployment yet. Keep this page open and retry.',
          )
        }
      } finally {
        closeLoadingModal()
        if (active) {
          setIsDeploying(false)
        }
        pendingWatchRef.current = null
      }
    }

    resolvePendingDeployment()

    return () => {
      active = false
    }
  }, [address, chainId, pendingDeployHash, publicClient])

  const tipInEth = useMemo(() => {
    if (!usdValue || !ethUsdPrice) return null
    const usd = Number(usdValue)
    if (!Number.isFinite(usd) || usd <= 0) return null
    return usd / ethUsdPrice
  }, [usdValue, ethUsdPrice])

  const isMerchantOwner =
    Boolean(address) &&
    Boolean(merchantOwner) &&
    address?.toLowerCase() === merchantOwner?.toLowerCase()

  const merchantBalanceUsd = useMemo(() => {
    if (merchantBalance === null || ethUsdPrice === null) return null
    const ethValue = Number(formatEther(merchantBalance))
    if (!Number.isFinite(ethValue)) return null
    return ethValue * ethUsdPrice
  }, [merchantBalance, ethUsdPrice])

  const sortedTipsHistory = useMemo(() => {
    return [...tipsHistory].sort((a, b) => {
      if (historySort === 'desc') return a.amountWei > b.amountWei ? -1 : 1
      return a.amountWei > b.amountWei ? 1 : -1
    })
  }, [tipsHistory, historySort])

  const loadEthUsdQuote = async (): Promise<number> => {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
    )
    if (!response.ok) throw new Error('Failed to fetch price')
    const json = (await response.json()) as { ethereum?: { usd?: number } }
    const price = json.ethereum?.usd
    if (!price) throw new Error('Price unavailable')
    setEthUsdPrice(price)
    return price
  }

  const refreshMerchantFunds = async () => {
    if (!merchantContract || !publicClient) {
      setMerchantOwner(null)
      setMerchantBalance(null)
      return
    }

    try {
      const [ownerResult, balanceResult] = await Promise.all([
        publicClient.readContract({
          address: merchantContract,
          abi: tipAbi,
          functionName: 'owner',
        }),
        publicClient.getBalance({
          address: merchantContract,
        }),
      ])

      setMerchantOwner(ownerResult as `0x${string}`)
      setMerchantBalance(balanceResult)

      if (ethUsdPrice === null) {
        await loadEthUsdQuote()
      }
    } catch {
      // Keep previous values when refresh fails.
    }
  }

  const loadTipsHistory = async () => {
    if (!merchantContract || !publicClient) {
      setTipsHistory([])
      setHistoryStatus('Deploy your contract first to see tip history.')
      return
    }

    try {
      setHistoryStatus('Loading tips history...')

      const usdPrice = ethUsdPrice ?? (await loadEthUsdQuote())
      const tipReceivedEvent = parseAbiItem(
        'event TipReceived(address indexed sender, uint256 amount, string message)',
      )

      const latestBlock = await publicClient.getBlockNumber()
      const maxRange = 9500n

      // Resolve contract deployment block to avoid scanning the whole chain.
      let fromBlock = 0n
      try {
        let low = 0n
        let high = latestBlock
        let deploymentBlock = latestBlock

        while (low <= high) {
          const mid = (low + high) / 2n
          const codeAtMid = await publicClient.getCode({
            address: merchantContract,
            blockNumber: mid,
          })

          if (codeAtMid && codeAtMid !== '0x') {
            deploymentBlock = mid
            if (mid === 0n) break
            high = mid - 1n
          } else {
            low = mid + 1n
          }
        }

        fromBlock = deploymentBlock
      } catch {
        // Fallback for RPCs that do not support historic code lookups.
        fromBlock = latestBlock > maxRange ? latestBlock - maxRange : 0n
      }

      const items: TipHistoryItem[] = []

      let currentFrom = fromBlock
      while (currentFrom <= latestBlock) {
        const currentTo =
          currentFrom + maxRange > latestBlock
            ? latestBlock
            : currentFrom + maxRange

        const chunkLogs = await publicClient.getLogs({
          address: merchantContract,
          event: tipReceivedEvent,
          fromBlock: currentFrom,
          toBlock: currentTo,
        })

        for (const log of chunkLogs) {
          if (!log.transactionHash) continue

          const amountWei = (log.args.amount ?? 0n) as bigint
          const amountEth = Number(formatEther(amountWei))
          const message = (log.args.message ?? '').toString()
          const sender =
            ((log.args.sender as `0x${string}` | undefined) ??
              '0x0000000000000000000000000000000000000000') as `0x${string}`

          items.push({
            txHash: log.transactionHash,
            sender,
            amountWei,
            amountEth,
            amountUsd: Number.isFinite(amountEth) ? amountEth * usdPrice : null,
            message,
          })
        }

        currentFrom = currentTo + 1n
      }

      setTipsHistory(items)
      setHistoryStatus(items.length > 0 ? `${items.length} tips found.` : 'No tips yet.')
    } catch {
      setHistoryStatus('Could not load tips history right now.')
    }
  }

  useEffect(() => {
    if (!isConnected || !merchantContract) {
      setMerchantOwner(null)
      setMerchantBalance(null)
      return
    }

    void refreshMerchantFunds()
  }, [isConnected, merchantContract, publicClient])

  useEffect(() => {
    if (!isConnected || !merchantContract || !publicClient) return

    const unwatch = publicClient.watchContractEvent({
      address: merchantContract,
      abi: tipAbi,
      eventName: 'TipReceived',
      poll: true,
      onLogs: () => {
        void refreshMerchantFunds()
        if (activeDashboardTab === 'history') {
          void loadTipsHistory()
        }
      },
      onError: () => {
        // Silent fail keeps UI stable if RPC has temporary issues.
      },
    })

    return () => {
      unwatch()
    }
  }, [isConnected, merchantContract, publicClient, activeDashboardTab])

  const deployContract = async () => {
    if (!isConnected || !address) {
      showFeedbackModal('error', 'Wallet Required', 'Connect MetaMask to deploy your contract.')
      return
    }
    if (merchantContract) {
      showFeedbackModal(
        'error',
        'Deployment Blocked',
        'This wallet already has a deployed contract.',
      )
      return
    }
    if (isDeploying || pendingDeployHash) {
      showFeedbackModal(
        'error',
        'Deployment Pending',
        'A deployment is already pending for this wallet.',
      )
      return
    }
    if (!walletClient || !publicClient) {
      showFeedbackModal(
        'error',
        'Wallet Client Unavailable',
        'Reconnect your wallet and try again.',
      )
      return
    }

    try {
      setIsDeploying(true)
      showLoadingModal(
        'Deploying Contract',
        'Confirm the transaction in your wallet to deploy your merchant contract.',
      )
      const deployHash = await walletClient.deployContract({
        abi: tipAbi,
        bytecode: tipBytecode,
        args: [address],
        account: address,
      })

      await savePendingDeployment(chainId, address, deployHash)
      setPendingDeployHash(deployHash)
    } catch {
      closeLoadingModal()
      setIsDeploying(false)
      showFeedbackModal('error', 'Deployment Failed', 'Deployment was canceled or failed.')
    }
  }

  const loadPrice = async () => {
    if (!isConnected) {
      showFeedbackModal('error', 'Wallet Required', 'Connect MetaMask to continue.')
      return
    }

    showLoadingModal('Fetching Price', 'Loading the latest ETH/USD quote...')
    try {
      const price = await loadEthUsdQuote()
      setEthUsdPrice(price)
      showFeedbackModal('success', 'Price Updated', `1 ETH = $${price.toFixed(2)} USD`)
    } catch {
      showFeedbackModal('error', 'Price Error', 'Could not load ETH price. Try again.')
    } finally {
      closeLoadingModal()
    }
  }

  const submitTip = async () => {
    if (!isConnected) {
      showFeedbackModal('error', 'Wallet Required', 'Connect MetaMask to continue.')
      return
    }
    if (!targetContract) {
      showFeedbackModal('error', 'Invalid Contract', 'Invalid merchant contract in URL.')
      return
    }
    if (!tipInEth || tipInEth <= 0) {
      showFeedbackModal('error', 'Invalid Amount', 'Set a valid USD amount first.')
      return
    }

    try {
      showLoadingModal('Submitting Tip', 'Confirm and wait for tip transaction confirmation...')
      const valueInWei = parseEther(tipInEth.toFixed(18))
      const hash = await writeContractAsync({
        address: targetContract,
        abi: tipAbi,
        functionName: 'tip',
        args: [tipMessage.trim()],
        value: valueInWei,
      })

      if (!publicClient) {
        showFeedbackModal('success', 'Tip Sent', `Transaction submitted: ${hash}`)
        return
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash })

      if (receipt.status !== 'success') {
        showFeedbackModal('error', 'Tip Failed', 'Transaction reverted on-chain.')
        return
      }

      setTipSuccessHash(hash)
      setShowThankYou(true)
      showFeedbackModal('success', 'Tip Paid', 'Tip paid successfully.')
      setUsdValue('')
      setTipMessage('')
    } catch {
      showFeedbackModal('error', 'Tip Failed', 'Transaction rejected or failed.')
    } finally {
      closeLoadingModal()
    }
  }

  const withdrawFunds = async () => {
    if (!isConnected) {
      showFeedbackModal('error', 'Wallet Required', 'Connect MetaMask to continue.')
      return
    }
    if (!merchantContract) {
      showFeedbackModal('error', 'No Contract', 'Deploy your contract first.')
      return
    }
    if (!isMerchantOwner) {
      showFeedbackModal(
        'error',
        'Permission Denied',
        'Only the contract owner can withdraw funds.',
      )
      return
    }

    try {
      setIsWithdrawing(true)
      showLoadingModal(
        'Withdrawing Funds',
        'Confirm and wait for withdraw transaction confirmation...',
      )
      const hash = await writeContractAsync({
        address: merchantContract,
        abi: tipAbi,
        functionName: 'withdraw',
        args: [],
      })

      if (!publicClient) {
        showFeedbackModal('success', 'Withdraw Sent', `Transaction submitted: ${hash}`)
        return
      }

      const receipt = await publicClient.waitForTransactionReceipt({ hash })
      if (receipt.status !== 'success') {
        showFeedbackModal('error', 'Withdraw Failed', 'Transaction reverted on-chain.')
        return
      }

      showFeedbackModal('success', 'Withdraw Successful', `Funds withdrawn: ${hash}`)
      await refreshMerchantFunds()
    } catch {
      showFeedbackModal('error', 'Withdraw Failed', 'Withdraw canceled or failed.')
    } finally {
      setIsWithdrawing(false)
      closeLoadingModal()
    }
  }

  const connectWallet = async () => {
    try {
      const dappUrl = import.meta.env.VITE_METAMASK_DAPP_URL ?? window.location.host
      const deepLinkTarget = dappUrl
        .replace(/^https?:\/\//i, '')
        .replace(/\/+$/, '')

      if (injectedConnector) {
        const injectedProvider = await injectedConnector.getProvider().catch(() => undefined)
        if (injectedProvider) {
          await connectAsync({ connector: injectedConnector })
          return
        }
      }

      if (isMobileBrowser && deepLinkTarget.length > 0) {
        window.location.assign(`${metaMaskDeepLinkBase}${deepLinkTarget}`)
        return
      }

      if (metaMaskConnector) {
        await connectAsync({ connector: metaMaskConnector })
        return
      }

      showFeedbackModal(
        'error',
        'No Wallet Connector',
        'No compatible wallet connector was found in this browser.',
      )
    } catch {
      // Error feedback is handled by connectError effect.
    }
  }

  return (
    <div className="page-shell">
      <div className="bg-orb orb-a" />
      <div className="bg-orb orb-b" />

      <header className="topbar">
        <button
          className={`brand ${activeDashboardTab === 'home' ? 'brand-active' : ''}`}
          type="button"
          onClick={() => setActiveDashboardTab('home')}
        >
          <span className="brand-icon">BJ</span>
          <div>
            <p className="brand-title">BLOCK JAR TIP</p>
            <p className="brand-subtitle">Trustless tipping experience</p>
          </div>
        </button>

        {!isTipPage && (
          <nav className="nav-menu">
            <button
              className={`nav-btn ${activeDashboardTab === 'profile' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveDashboardTab('profile')}
            >
              <span className="nav-icon">P</span>
              My Tip Profile
            </button>
            <button
              className={`nav-btn ${activeDashboardTab === 'funds' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveDashboardTab('funds')}
            >
              <span className="nav-icon">$</span>
              My Funds
            </button>
            <button
              className={`nav-btn ${activeDashboardTab === 'history' ? 'active' : ''}`}
              type="button"
              onClick={() => setActiveDashboardTab('history')}
            >
              <span className="nav-icon">H</span>
              Tips History
            </button>
          </nav>
        )}

        <div className="wallet-box">
          {!isConnected ? (
            <button
              className="primary-btn"
              onClick={() => void connectWallet()}
              type="button"
              disabled={isConnecting || (!injectedConnector && !metaMaskConnector)}
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </button>
          ) : (
            <>
              <span className="wallet-chip">
                {address?.slice(0, 6)}...{address?.slice(-4)}
              </span>
              <button className="ghost-btn" type="button" onClick={() => disconnect()}>
                Disconnect
              </button>
            </>
          )}
        </div>
      </header>

      <main>
        {!isTipPage && activeDashboardTab === 'home' && (
          <section className="hero-card">
            <div>
              <p className="kicker">Next-gen creator support</p>
              <h1>
                Instant tips, transparent payments,
                <br />
                powered by Web3.
              </h1>
              <p className="hero-text">
                Connect your wallet to generate your private tip profile. Anyone
                scanning your QR goes directly to your tipping page.
              </p>
            </div>
            <div className="stats-grid">
              <div className="stat-item">
                <p>Network</p>
                <strong>Sepolia ETH</strong>
              </div>
              <div className="stat-item">
                <p>Contract</p>
                <strong>
                  {merchantContract
                    ? 'Deployed'
                    : pendingDeployHash
                      ? 'Deploy pending'
                      : 'Not deployed'}
                </strong>
              </div>
              <div className="stat-item">
                <p>Wallet status</p>
                <strong>{isConnected ? 'Connected' : 'Disconnected'}</strong>
              </div>
            </div>
          </section>
        )}

        {!isTipPage && activeDashboardTab === 'profile' && (
          <section className="card">
            <h2>My Tip Profile</h2>
            <p>
              To use any feature, wallet login is required. After connecting, your
              personalized tip link and QR code are generated instantly.
            </p>

            {!isConnected && (
              <div className="notice">
                Please connect your wallet to generate your link and QR code.
              </div>
            )}

            {isConnected && address && !merchantContract && (
              <div className="deploy-panel">
                <p>
                  Step 1: Deploy your own merchant contract. This is required
                  before you can receive tips.
                </p>
                <button
                  className="primary-btn"
                  type="button"
                  onClick={deployContract}
                  disabled={isDeploying || Boolean(pendingDeployHash)}
                >
                  {isDeploying || pendingDeployHash
                    ? 'Deployment in progress...'
                    : 'Deploy My Tip Contract'}
                </button>
              </div>
            )}

            {isConnected && address && merchantContract && (
              <div className="profile-grid">
                <div>
                  <label htmlFor="shareLink">Your share link</label>
                  <input id="shareLink" value={userShareLink} readOnly />
                  <p className="hint-text">Contract: {merchantContract}</p>
                </div>
                <div className="qr-wrap">
                  <QRCodeSVG
                    value={userShareLink}
                    size={180}
                    fgColor="#9fffd0"
                    bgColor="transparent"
                    level="H"
                  />
                </div>
              </div>
            )}
          </section>
        )}

        {!isTipPage && activeDashboardTab === 'funds' && (
          <section className="card">
            <h2>My Funds</h2>
            {!isConnected && (
              <div className="notice">Connect MetaMask to view your funds.</div>
            )}

            {isConnected && !merchantContract && (
              <div className="notice">
                Deploy your contract first in My Tip Profile to unlock this section.
              </div>
            )}

            {isConnected && merchantContract && (
              <div className="funds-panel">
                <h3>Contract Funds</h3>
                <div className="balance-highlight">
                  <p className="balance-label">Available to withdraw (USD)</p>
                  <strong>
                    {merchantBalanceUsd !== null
                      ? new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                          maximumFractionDigits: 2,
                        }).format(merchantBalanceUsd)
                      : '$-'}
                  </strong>
                  <p className="hint-text">
                    {merchantBalance !== null
                      ? `${formatEther(merchantBalance)} ETH`
                      : '- ETH'}
                  </p>
                </div>
                <p>
                  Owner: <span className="mono">{merchantOwner ?? 'Loading...'}</span>
                </p>

                <div className="inline-actions">
                  <button className="ghost-btn" type="button" onClick={refreshMerchantFunds}>
                    Refresh Balance
                  </button>
                  <button
                    className="primary-btn"
                    type="button"
                    onClick={withdrawFunds}
                    disabled={isWithdrawing || isSigning || !isMerchantOwner}
                  >
                    {isWithdrawing ? 'Withdrawing...' : 'Withdraw Funds'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {!isTipPage && activeDashboardTab === 'history' && (
          <section className="card">
            <h2>Tips History</h2>
            {!isConnected && (
              <div className="notice">Connect MetaMask to view your tips history.</div>
            )}

            {isConnected && !merchantContract && (
              <div className="notice">
                Deploy your contract first in My Tip Profile to unlock history.
              </div>
            )}

            {isConnected && merchantContract && (
              <>
                <div className="inline-actions">
                  <button className="ghost-btn" type="button" onClick={loadTipsHistory}>
                    Refresh History
                  </button>
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={() =>
                      setHistorySort((prev) => (prev === 'desc' ? 'asc' : 'desc'))
                    }
                  >
                    Sort: {historySort === 'desc' ? 'Highest first' : 'Lowest first'}
                  </button>
                </div>

                {historyStatus && <p className="hint-text">{historyStatus}</p>}

                {sortedTipsHistory.length > 0 && (
                  <div className="history-list">
                    {sortedTipsHistory.map((tip) => (
                      <article className="history-item" key={`${tip.txHash}-${tip.sender}`}>
                        <div className="history-main">
                          <p className="balance-label">Tip amount (USD)</p>
                          <strong>
                            {tip.amountUsd !== null
                              ? new Intl.NumberFormat('en-US', {
                                  style: 'currency',
                                  currency: 'USD',
                                  maximumFractionDigits: 2,
                                }).format(tip.amountUsd)
                              : '$-'}
                          </strong>
                          <p className="hint-text">{tip.amountEth.toFixed(8)} ETH</p>
                        </div>
                        <p>
                          Sender:{' '}
                          <span className="mono">
                            {tip.sender.slice(0, 6)}...{tip.sender.slice(-4)}
                          </span>
                        </p>
                        <p>
                          Message:{' '}
                          {tip.message.trim().length > 0 ? tip.message : 'No message'}
                        </p>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {isTipPage && (
          <section className="card tip-card">
            <h2>Send a Tip</h2>
            <p>
              Merchant wallet: <span className="mono">{receiver ?? 'Unknown'}</span>
            </p>
            <p>
              Merchant contract: <span className="mono">{targetContract}</span>
            </p>
            {!isConnected && (
              <div className="notice">
                Connect MetaMask to interact with this tipping page.
              </div>
            )}

            {showThankYou ? (
              <div className="thankyou-panel">
                <h3>Thank You For Your Tip</h3>
                <p>
                  Your payment was confirmed on-chain and sent to the merchant
                  contract.
                </p>
                {tipSuccessHash && (
                  <p>
                    Tx Hash: <span className="mono">{tipSuccessHash}</span>
                  </p>
                )}
                <button
                  className="primary-btn"
                  type="button"
                  onClick={() => {
                    setShowThankYou(false)
                    setTipSuccessHash(null)
                  }}
                >
                  Send Another Tip
                </button>
              </div>
            ) : (
              <>
                <div className="form-grid">
                  <div>
                    <label htmlFor="usdTip">Tip amount (USD)</label>
                    <input
                      id="usdTip"
                      placeholder="e.g. 5"
                      type="number"
                      min="0"
                      step="0.01"
                      value={usdValue}
                      onChange={(e) => setUsdValue(e.target.value)}
                      disabled={!isConnected}
                    />
                  </div>

                  <div>
                    <label htmlFor="tipMessage">Message (optional)</label>
                    <input
                      id="tipMessage"
                      placeholder="Great work!"
                      value={tipMessage}
                      onChange={(e) => setTipMessage(e.target.value)}
                      disabled={!isConnected}
                    />
                  </div>
                </div>

                <div className="inline-actions">
                  <button
                    className="ghost-btn"
                    type="button"
                    onClick={loadPrice}
                    disabled={!isConnected}
                  >
                    Refresh ETH Price
                  </button>
                </div>

                {tipInEth && (
                  <p>
                    Converted value: <strong>{tipInEth.toFixed(8)} ETH</strong>{' '}
                    ({formatEther(parseEther(tipInEth.toFixed(18)))} ETH in wei)
                  </p>
                )}

                <button
                  className="primary-btn large"
                  type="button"
                  onClick={submitTip}
                  disabled={!isConnected || isSigning}
                >
                  {isSigning ? 'Waiting signature...' : 'Sign Tip Transaction'}
                </button>
              </>
            )}
          </section>
        )}
      </main>

      {feedbackModal.isOpen && (
        <div className="modal-backdrop" onClick={closeFeedbackModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{feedbackModal.title}</h3>
              <div className="modal-header-actions">
                <span
                  className={`modal-chip ${
                    feedbackModal.variant === 'success' ? 'success' : 'error'
                  }`}
                >
                  {feedbackModal.variant === 'success' ? 'SUCCESS' : 'ERROR'}
                </span>
                <button className="modal-close-btn" type="button" onClick={closeFeedbackModal}>
                  X
                </button>
              </div>
            </div>
            <p>{feedbackModal.message}</p>
          </div>
        </div>
      )}

      {loadingModal.isOpen && (
        <div className="modal-backdrop loading">
          <div className="modal-card loading" onClick={(e) => e.stopPropagation()}>
            <div className="spinner" />
            <h3>{loadingModal.title}</h3>
            <p>{loadingModal.message}</p>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
