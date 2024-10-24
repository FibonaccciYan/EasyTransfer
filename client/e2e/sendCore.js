/**
 * @description The SendCore class is responsible for sending data to the target peer
 * 
 * @constructor
 * 
 * @method sendData - Send data to the target peer
 * @method getChannelState - Get the state of the data channel
 */
class SendCore {
  sendProgress = 0;
  maxBufferedAmount = 1024 * 16; // 16KB is a safe value for most browsers
  sendChannel = null;
  chunkQueue = [];
  getPubKey = null;
  pubKey = null;

  /**
   * @description Constructor for the SendCore class
   * 
   * @param {Object} peerConnection 
   * @param {Function} setConnectSuccess
   * 
   * @returns {void}
   */
  constructor(peerConnection, setConnectSuccess, getPubKey) {
    this.establishDataChannel(peerConnection, setConnectSuccess)
    this.getPubKey = getPubKey
  }

  /**
   * @description Send data to the target peer
   * 
   * @param {String} data - The data to send
   * @returns {void}
   */
  async sendData(data) {
    this.chunkQueue.push(data)
    
    await this.processQueue();
  }

  /**
   * @description Get the state of the data channel
   * 
   * @returns {String} The state of the data channel
   */
  getChannelState() {
    return this.sendChannel.readyState;
  }

  establishDataChannel(peerConnection, setConnectSuccess) {
    this.sendChannel = peerConnection.createDataChannel(
      'fileTransfer', 
      { ordered: true, maxRetransmits: 2 }
    )

    this.sendChannel.bufferedAmountLowThreshold = this.maxBufferedAmount

    this.sendChannel.onopen = () => {
      console.log(`[INFO] Data channel opened`)
      setConnectSuccess(true)
    }

    this.sendChannel.onerror = (error) => {
      console.error(`[ERR] Data channel error: ${error}`)
      setConnectSuccess(false)
    }

    this.sendChannel.onclose = () => {
      console.log(`[INFO] Data channel closed`)
      setConnectSuccess(false)
    }

    this.sendChannel.onbufferedamountlow = async () => {
      await this.processQueue()
    }
  }
  
  async processQueue() {
    if (!this.pubKey) {
      this.pubKey = await this.getPubKey()
    }

    while (this.chunkQueue.length > 0 && this.sendChannel.bufferedAmount <= this.maxBufferedAmount) {
      let chunk = this.chunkQueue.shift()

      if (!(chunk instanceof ArrayBuffer) && !(ArrayBuffer.isView(chunk))) {
        chunk = new TextEncoder().encode(chunk)
      }

      const encryptedChunk = await window.crypto.subtle.encrypt(
        {
          name: "RSA-OAEP"
        },
        this.pubKey,
        chunk
      );

      this.sendChannel.send(encryptedChunk)

      if (chunk.byteLength) {
        this.sendProgress += chunk.byteLength
      }
    }
  }
}

export default SendCore;