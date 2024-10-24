import { io } from 'socket.io'

/**
 * @description This class is the core of the connection between the peers.
 *  
 * @constructor
 * 
 * @method registerClient - Register the client with the signal server
 * @method connectTarget - Connect to the target peer
 * 
 * @property {Object} peerConnection - The RTCPeerConnection object
 * @property {String} clientId - The id of the client
 * @property {String} targetId - The id of the target peer
 */
class ConnectCore {
  /* Member variables */
  signalServerUrl = 'https://easy-transfer.glitch.me/';
  peerConnectionConfiguration = {
    iceServers: [
      {
        urls: "stun:stun.relay.metered.ca:80",
      },
      {
        urls: "turn:global.relay.metered.ca:80",
        username: "cf841207b56ebddc17948dde",
        credential: "0dGvvEm7eq2UaqlW",
      },
      {
        urls: "turn:global.relay.metered.ca:80?transport=tcp",
        username: "cf841207b56ebddc17948dde",
        credential: "0dGvvEm7eq2UaqlW",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "cf841207b56ebddc17948dde",
        credential: "0dGvvEm7eq2UaqlW",
      },
      {
        urls: "turns:global.relay.metered.ca:443?transport=tcp",
        username: "cf841207b56ebddc17948dde",
        credential: "0dGvvEm7eq2UaqlW",
      },
    ]
  };
  socket = null;
  clientId = 'LOADING';
  targetId = '';
  pubKey = '';
  privKey = '';
  setClienId = null;
  setPubKey = null;
  setPrivKey = null;
  setRegistered = null;
  peerConnection = null;
  candidateQueue = [];
  
  /**
   * @description Initialize the connection core
   * 
   * @returns {void}
   */
  constructor(setClientId, setPubKey, setPrivKey, setRegistered) {
    this.setClientId = setClientId
    this.setPubKey = setPubKey
    this.setPrivKey = setPrivKey
    this.setRegistered = setRegistered
    // Connect to the signal server
    this.socket = io.connect(this.signalServerUrl)
    // Establish the peer connection
    this.peerConnection = new RTCPeerConnection(this.peerConnectionConfiguration)
    // Handle messages from the signal server
    this.handleServerMsg()

    console.log('[INFO] ===Connection core initialized===')
  }

  /**
   * @description Register the client with the signal server
   * 
   * @param {String} id - The id of the client
   * @returns {void}
   */
  async registerClient() {
    // Generate public-private key pair
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["encrypt", "decrypt"]
    );

    this.pubKey = keyPair.publicKey;
    this.privKey = keyPair.privateKey;
    this.setPrivKey(this.privKey);

    // Export the public key to send to the server
    const exportedPubKey = await window.crypto.subtle.exportKey(
      "spki",
      this.pubKey
    );

    // Convert the exported key to a base64 string
    const pubKeyBase64 = btoa(String.fromCharCode(...new Uint8Array(exportedPubKey)));

    // Emit the public key to the signal server
    this.socket.emit('register', pubKeyBase64);

    console.log(`[INFO] ===Registering client===`)
    console.log(`[INFO] Public key: ${pubKeyBase64}`)
  }

  /**
   * @description Connect to the target peer
   * 
   * @param {String} id - The id of the target peer
   * @returns {void}
   */
  connectTarget(id) {
    console.log(`[INFO] ===Connecting to ${id}===`)

    this.targetId = id
    this.sendOffer()
    this.sendIceCandidate()
  }

  sendOffer() { // Send the offer to the target peer
    this.peerConnection.createOffer().then((offer) => {
      return this.peerConnection.setLocalDescription(offer)
    }).then(() => {
      this.socket.emit('offer', this.peerConnection.localDescription, this.clientId, this.targetId)
    })

    console.log(`[INFO] Sending offer to ${this.targetId}`)
  }

  sendIceCandidate() { // Send the ICE candidate to the target peer
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('candidate', event.candidate, this.targetId)

        console.log(`[INFO] Sending candidate to ${this.targetId}`)
      }
    }
  }

  handleServerMsg() { // Handle messages from the signal server
    this.socket.on('success', (id) => {
      console.log(`[INFO] ===Client registered with id ${id}===`)
      this.clientId = id
      this.setClientId(id)
      this.setRegistered(true)
    })

    this.socket.on('disconnect', () => {
      console.log('[INFO] ===Disconnected from the signal server===');
      this.setRegistered(false);
      window.location.reload();
    });

    this.socket.on('offer', (sdp, id, keyBase64) => {
      console.log(`[INFO] ===Connecting to ${id}===`)
      console.log(`[INFO] Peer public key: ${keyBase64}`)

      const keyArray = new Uint8Array(atob(keyBase64).split('').map(c => c.charCodeAt(0)))
      this.convertToCryptoKey(keyArray).then((key) => {
        this.targetId = id
        this.setPubKey(key)
        this.handleOffer(sdp)
        this.sendIceCandidate()

        console.log(`[INFO] Received offer from ${this.targetId}`)
      }).catch((error) => {
        console.error(`[ERR] Error converting key: ${error}`)
      });          
    })

    this.socket.on('answer', (sdp, id, keyBase64) => {
      console.log(`[INFO] Peer public key: ${keyBase64}`)

      const keyArray = new Uint8Array(atob(keyBase64).split('').map(c => c.charCodeAt(0)))
      this.convertToCryptoKey(keyArray).then((key) => {
        this.setPubKey(key)
        this.handleAnswer(sdp)

        console.log(`[INFO] Received answer from ${this.targetId}`)
      }).catch((error) => {
        console.error(`[ERR] Error converting key: ${error}`)
      });
    })

    this.socket.on('candidate', (candidate) => {
      console.log(`[INFO] Received candidate from ${this.targetId}`)

      this.handleCandidate(candidate)
    });
  }

  handleOffer(sdp) { // Handle the offer from the target peer
    this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp)).then(() => {
      return this.peerConnection.createAnswer()
    }).then((answer) => {
      return this.peerConnection.setLocalDescription(answer)
    }).then(() => {
      this.socket.emit('answer', this.peerConnection.localDescription, this.clientId, this.targetId)

      console.log(`[INFO] Sending answer to ${this.targetId}`)
    }).then(() => {
      this.addIceCandidate()
    });
  }

  handleAnswer(sdp) { // Handle the answer from the target peer
    this.peerConnection.setRemoteDescription(new RTCSessionDescription(sdp)).then(() => {
      this.addIceCandidate()
    });
  }

  handleCandidate(candidate) { // Handle the ICE candidate from the target peer
    if (this.peerConnection.remoteDescription) {
      this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))

      console.log(`[INFO] Added ${this.targetId} to ICE candidate`)
    } else {
      this.candidateQueue.push(candidate)
    }
  }

  addIceCandidate() { // Add the ICE candidate to the peer connection
    while (this.candidateQueue.length) {
      this.peerConnection.addIceCandidate(new RTCIceCandidate(this.candidateQueue.shift()))
    }

    console.log(`[INFO] Added ${this.targetId} to ICE candidate`)
  }

  async convertToCryptoKey(keyArray) {
    return window.crypto.subtle.importKey(
      "spki",
      keyArray,
      {
        name: "RSA-OAEP",
        hash: "SHA-256"
      },
      true,
      ["encrypt"]
    );
  }
}

export default ConnectCore;